import type { ProxyEnvironment } from './environment';
import { createHealthResponse, type ProxyHealthDependency } from './health';
import {
  type CapabilityTokenClaims,
  hasProxyPermission,
  type ProxyPermission,
  verifyCapabilityToken,
} from './capability-token';
import {
  type AuditSink,
  createConsoleAuditSink,
  type ProxyAuditEvent,
  redactAuditEvent,
} from './audit';

type ProxyService = 'github' | 'anthropic';

type UpstreamFetch = (request: Request) => Promise<Response>;

type GitHubCredentialResolver = (
  claims: CapabilityTokenClaims,
) => Promise<string | null> | string | null;

export type ProxyHandlerOptions = {
  environment: ProxyEnvironment;
  upstreamFetch?: UpstreamFetch;
  auditSink?: AuditSink;
  githubCredentialResolver?: GitHubCredentialResolver;
  healthDependencies?: () => Promise<ProxyHealthDependency[]>;
  now?: () => Date;
};

type ValidatedRoute = {
  service: ProxyService;
  method: string;
  upstreamUrl: URL;
  upstreamHost: string;
  upstreamPath: string;
  requiredPermission: ProxyPermission;
};

type RouteValidationResult =
  | { ok: true; route: ValidatedRoute }
  | { ok: false; status: number; reason: string; service?: ProxyService; upstreamHost?: string };

const unsafeGitHubRestMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const safeGitHubRestMethods = new Set(['GET', 'HEAD']);
const maxUpstreamRequestBodyBytes = 1024 * 1024;

export function createProxyHandler(
  options: ProxyHandlerOptions,
): (request: Request) => Promise<Response> {
  const upstreamFetch = options.upstreamFetch ?? fetch;
  const auditSink = options.auditSink ?? createConsoleAuditSink();
  const now = options.now ?? (() => new Date());

  return async (request) => {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      const externalDependencies = (await options.healthDependencies?.()) ?? [];
      return createHealthResponse({
        dependencies: [
          { name: 'configuration', ok: true },
          {
            name: 'credential_resolver',
            ok: options.githubCredentialResolver !== undefined,
            detail:
              options.githubCredentialResolver === undefined
                ? 'GitHub credential resolver is not configured'
                : undefined,
          },
          ...externalDependencies,
        ],
      });
    }

    const service = parseService(url.pathname);
    const token = extractCapabilityToken(request, service);
    if (!token) {
      await emitAudit(
        auditSink,
        unauthorizedAuditEvent(request, 'missing_capability_token'),
        options,
      );
      return errorResponse(401, 'missing_capability_token');
    }

    const verification = verifyCapabilityToken(token, options.environment.PROXY_SIGNING_KEY, now());
    if (!verification.ok) {
      await emitAudit(
        auditSink,
        unauthorizedAuditEvent(request, `invalid_capability_token:${verification.reason}`),
        options,
        [token],
      );
      return errorResponse(403, 'invalid_capability_token');
    }

    const routeResult = validateProxyRoute(
      url,
      service,
      request.method,
      verification.claims,
      options.environment,
    );
    if (!routeResult.ok) {
      await emitAudit(
        auditSink,
        blockedAuditEvent(request, routeResult, verification.claims),
        options,
        [token],
      );
      return errorResponse(routeResult.status, routeResult.reason);
    }

    if (!hasProxyPermission(verification.claims, routeResult.route.requiredPermission)) {
      await emitAudit(
        auditSink,
        blockedAuditEvent(
          request,
          {
            ok: false,
            status: 403,
            reason: 'capability_missing_permission',
            service: routeResult.route.service,
            upstreamHost: routeResult.route.upstreamHost,
          },
          verification.claims,
        ),
        options,
        [token],
      );
      return errorResponse(403, 'capability_missing_permission');
    }

    return forwardValidatedRequest({
      request,
      route: routeResult.route,
      claims: verification.claims,
      options,
      upstreamFetch,
      auditSink,
      capabilityToken: token,
    });
  };
}

function validateProxyRoute(
  url: URL,
  service: ProxyService | null,
  method: string,
  claims: CapabilityTokenClaims,
  environment: ProxyEnvironment,
): RouteValidationResult {
  const route = parseRoute(url, service);
  if (!route) {
    return { ok: false, status: 404, reason: 'unknown_proxy_route' };
  }

  const allowlist =
    route.service === 'github'
      ? environment.GITHUB_EGRESS_ALLOW
      : environment.ANTHROPIC_EGRESS_ALLOW;

  if (!isAllowedHost(route.upstreamHost, allowlist)) {
    return {
      ok: false,
      status: 403,
      reason: 'upstream_host_not_allowed',
      service: route.service,
      upstreamHost: route.upstreamHost,
    };
  }

  if (route.service === 'github') {
    return validateGitHubRoute(method, route, claims);
  }

  return validateAnthropicRoute(method, route);
}

function validateGitHubRoute(
  method: string,
  route: Omit<ValidatedRoute, 'method' | 'requiredPermission'>,
  claims: CapabilityTokenClaims,
): RouteValidationResult {
  if (
    !isGitHubPathAllowed(method, route.upstreamHost, route.upstreamPath, route.upstreamUrl, claims)
  ) {
    return {
      ok: false,
      status: 403,
      reason: 'github_request_not_allowed',
      service: 'github',
      upstreamHost: route.upstreamHost,
    };
  }

  return {
    ok: true,
    route: { ...route, method, requiredPermission: 'github:read' },
  };
}

function validateAnthropicRoute(
  method: string,
  route: Omit<ValidatedRoute, 'method' | 'requiredPermission'>,
): RouteValidationResult {
  if (method !== 'POST' || !isAllowedAnthropicPath(route.upstreamPath)) {
    return {
      ok: false,
      status: 403,
      reason: 'anthropic_request_not_allowed',
      service: 'anthropic',
      upstreamHost: route.upstreamHost,
    };
  }

  return {
    ok: true,
    route: { ...route, method, requiredPermission: 'anthropic:invoke' },
  };
}

function isAllowedAnthropicPath(upstreamPath: string): boolean {
  return upstreamPath === '/v1/messages';
}

function isGitHubPathAllowed(
  method: string,
  host: string,
  upstreamPath: string,
  upstreamUrl: URL,
  claims: CapabilityTokenClaims,
): boolean {
  if (host === 'api.github.com') {
    if (!safeGitHubRestMethods.has(method)) return false;
    return isScopedGitHubRestPath(upstreamPath, claims);
  }

  if (host === 'github.com') {
    return isScopedGitSmartHttpPath(method, upstreamPath, upstreamUrl, claims);
  }

  if (unsafeGitHubRestMethods.has(method)) {
    return false;
  }

  return safeGitHubRestMethods.has(method) && isScopedGitHubRestPath(upstreamPath, claims);
}

function parseRoute(
  url: URL,
  service: ProxyService | null,
): Omit<ValidatedRoute, 'method' | 'requiredPermission'> | null {
  if (!service) {
    return null;
  }

  const prefix = `/${service}/`;
  const routeTail = url.pathname.slice(prefix.length);
  const hostSeparatorIndex = routeTail.indexOf('/');
  if (hostSeparatorIndex <= 0) {
    return null;
  }

  const upstreamHost = safeDecodeURIComponent(
    routeTail.slice(0, hostSeparatorIndex),
  )?.toLowerCase();
  if (upstreamHost === undefined || !isValidHost(upstreamHost)) {
    return null;
  }

  const upstreamPath = routeTail.slice(hostSeparatorIndex);
  const upstreamUrl = new URL(`https://${upstreamHost}${upstreamPath}${url.search}`);

  return {
    service,
    upstreamUrl,
    upstreamHost,
    upstreamPath,
  };
}

function parseService(pathname: string): ProxyService | null {
  if (pathname.startsWith('/github/')) {
    return 'github';
  }

  if (pathname.startsWith('/anthropic/')) {
    return 'anthropic';
  }

  return null;
}

async function forwardValidatedRequest(input: {
  request: Request;
  route: ValidatedRoute;
  claims: CapabilityTokenClaims;
  options: ProxyHandlerOptions;
  upstreamFetch: UpstreamFetch;
  auditSink: AuditSink;
  capabilityToken: string;
}): Promise<Response> {
  const credential = await resolveCredential(input.route.service, input.claims, input.options);
  if (!credential) {
    await emitAudit(
      input.auditSink,
      auditEventForRequest(input.request, input.route, input.claims, {
        outcome: 'blocked',
        status: 503,
        reason: 'credential_not_available',
        credentialInjected: false,
      }),
      input.options,
      [input.capabilityToken],
    );
    return errorResponse(503, 'credential_not_available');
  }

  const upstreamRequest = await createUpstreamRequest(input.request, input.route, credential);
  if (!upstreamRequest.ok) {
    await emitAudit(
      input.auditSink,
      auditEventForRequest(input.request, input.route, input.claims, {
        outcome: 'blocked',
        status: upstreamRequest.status,
        reason: upstreamRequest.reason,
        credentialInjected: false,
      }),
      input.options,
      [input.capabilityToken],
    );
    return errorResponse(upstreamRequest.status, upstreamRequest.reason);
  }
  const upstreamResponse = await input.upstreamFetch(upstreamRequest.request);

  if (isRedirectResponse(upstreamResponse)) {
    await emitAudit(
      input.auditSink,
      auditEventForRequest(input.request, input.route, input.claims, {
        outcome: 'blocked',
        status: 502,
        reason: 'upstream_redirect_not_allowed',
        credentialInjected: true,
      }),
      input.options,
      [input.capabilityToken, credential],
    );
    return errorResponse(502, 'upstream_redirect_not_allowed');
  }

  await emitAudit(
    input.auditSink,
    auditEventForRequest(input.request, input.route, input.claims, {
      outcome: 'forwarded',
      status: upstreamResponse.status,
      credentialInjected: true,
    }),
    input.options,
    [input.capabilityToken, credential],
  );

  return sanitizeUpstreamResponse(upstreamResponse);
}

async function createUpstreamRequest(
  request: Request,
  route: ValidatedRoute,
  credential: string,
): Promise<{ ok: true; request: Request } | { ok: false; status: number; reason: string }> {
  const headers = sanitizeForwardedHeaders(request.headers);
  if (route.service === 'github') {
    headers.set('authorization', `Bearer ${credential}`);
  } else {
    headers.set('x-api-key', credential);
  }

  const body =
    route.method === 'GET' || route.method === 'HEAD'
      ? undefined
      : await readBoundedRequestBody(request);
  if (body instanceof Response) {
    return { ok: false, status: body.status, reason: 'request_body_too_large' };
  }

  return {
    ok: true,
    request: new Request(route.upstreamUrl, {
      method: route.method,
      headers,
      body,
      redirect: 'manual',
    }),
  };
}

async function readBoundedRequestBody(request: Request): Promise<ArrayBuffer | Response> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength > maxUpstreamRequestBodyBytes) {
      return errorResponse(413, 'request_body_too_large');
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > maxUpstreamRequestBodyBytes) {
    return errorResponse(413, 'request_body_too_large');
  }
  return body;
}

function sanitizeForwardedHeaders(headers: Headers): Headers {
  const forwardedHeaders = new Headers(headers);
  const blockedHeaders = [
    'authorization',
    'cookie',
    'connection',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'x-api-key',
  ];

  for (const header of blockedHeaders) {
    forwardedHeaders.delete(header);
  }

  return forwardedHeaders;
}

function sanitizeUpstreamResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete('authorization');
  headers.delete('proxy-authorization');
  headers.delete('set-cookie');
  headers.delete('x-api-key');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isRedirectResponse(response: Response): boolean {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

async function resolveCredential(
  service: ProxyService,
  claims: CapabilityTokenClaims,
  options: ProxyHandlerOptions,
): Promise<string | null> {
  if (service === 'anthropic') {
    return options.environment.ANTHROPIC_API_KEY;
  }

  return options.githubCredentialResolver?.(claims) ?? null;
}

function extractCapabilityToken(request: Request, service: ProxyService | null): string | null {
  if (service === 'anthropic') {
    const apiKey = request.headers.get('x-api-key');
    if (apiKey) return apiKey;
  }

  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return null;
  }

  const match = /^Bearer (?<token>\S+)$/iu.exec(authorization);
  return match?.groups?.token ?? null;
}

function isAllowedHost(host: string, allowlist: readonly string[]): boolean {
  return allowlist.some((allowedHost) => allowedHost.toLowerCase() === host);
}

function isValidHost(host: string): boolean {
  return /^[a-z0-9.-]+$/u.test(host) && !host.includes('..') && host.length <= 253;
}

function isScopedGitHubRestPath(pathname: string, claims: CapabilityTokenClaims): boolean {
  const segments = decodePathSegments(pathname);
  if (segments === null || segments.length < 3 || segments[0] !== 'repos') {
    return false;
  }

  return isSameRepository(segments[1], segments[2], claims);
}

function isScopedGitSmartHttpPath(
  method: string,
  pathname: string,
  upstreamUrl: URL,
  claims: CapabilityTokenClaims,
): boolean {
  const segments = decodePathSegments(pathname);
  if (
    segments === null ||
    segments.length < 3 ||
    !isSameRepository(segments[0], trimGitSuffix(segments[1]), claims)
  ) {
    return false;
  }

  if (method === 'GET') {
    return (
      segments[2] === 'info' &&
      segments[3] === 'refs' &&
      upstreamUrl.searchParams.get('service') === 'git-upload-pack'
    );
  }

  return method === 'POST' && segments[2] === 'git-upload-pack';
}

function decodePathSegments(pathname: string): string[] | null {
  const segments: string[] = [];

  for (const segment of pathname.split('/').filter(Boolean)) {
    const decodedSegment = safeDecodeURIComponent(segment);
    if (
      decodedSegment === undefined ||
      decodedSegment === '.' ||
      decodedSegment === '..' ||
      decodedSegment.includes('%')
    ) {
      return null;
    }

    segments.push(decodedSegment);
  }

  return segments;
}

function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function trimGitSuffix(repositoryName: string): string {
  return repositoryName.endsWith('.git') ? repositoryName.slice(0, -'.git'.length) : repositoryName;
}

function isSameRepository(owner: string, name: string, claims: CapabilityTokenClaims): boolean {
  return (
    owner.toLowerCase() === claims.repositoryOwner.toLowerCase() &&
    name.toLowerCase() === claims.repositoryName.toLowerCase()
  );
}

function unauthorizedAuditEvent(request: Request, reason: string): ProxyAuditEvent {
  return {
    type: 'proxy_audit_event',
    timestamp: new Date().toISOString(),
    service: 'proxy',
    outcome: 'rejected',
    status: reason === 'missing_capability_token' ? 401 : 403,
    method: request.method,
    reason,
  };
}

function blockedAuditEvent(
  request: Request,
  routeResult: Extract<RouteValidationResult, { ok: false }>,
  claims: CapabilityTokenClaims,
): ProxyAuditEvent {
  return {
    type: 'proxy_audit_event',
    timestamp: new Date().toISOString(),
    service: routeResult.service ?? 'proxy',
    outcome: 'blocked',
    status: routeResult.status,
    method: request.method,
    runId: claims.runId,
    userId: claims.userId,
    repositoryId: claims.repositoryId,
    repository: `${claims.repositoryOwner}/${claims.repositoryName}`,
    upstreamHost: routeResult.upstreamHost,
    reason: routeResult.reason,
  };
}

function auditEventForRequest(
  request: Request,
  route: ValidatedRoute,
  claims: CapabilityTokenClaims,
  patch: Pick<ProxyAuditEvent, 'outcome' | 'status'> &
    Partial<Pick<ProxyAuditEvent, 'reason' | 'credentialInjected'>>,
): ProxyAuditEvent {
  return {
    type: 'proxy_audit_event',
    timestamp: new Date().toISOString(),
    service: route.service,
    method: request.method,
    runId: claims.runId,
    userId: claims.userId,
    repositoryId: claims.repositoryId,
    repository: `${claims.repositoryOwner}/${claims.repositoryName}`,
    upstreamHost: route.upstreamHost,
    upstreamPath: route.upstreamPath,
    ...patch,
  };
}

async function emitAudit(
  auditSink: AuditSink,
  event: ProxyAuditEvent,
  options: ProxyHandlerOptions,
  extraSecrets: readonly string[] = [],
): Promise<void> {
  const secrets = [
    options.environment.ANTHROPIC_API_KEY,
    options.environment.PROXY_SIGNING_KEY,
    ...extraSecrets,
  ];

  await auditSink(redactAuditEvent(event, secrets));
}

function errorResponse(status: number, code: string): Response {
  return Response.json({ ok: false, error: code }, { status });
}
