import { createRequire } from 'node:module';
import { McpServer, ProtocolError } from '@modelcontextprotocol/server';
import type { ServerCapabilities } from '@modelcontextprotocol/server';
import { allTools, conformanceOnlyTools } from './tools/index.js';
import { allResources } from './resources/index.js';
import { allPrompts } from './prompts/index.js';
import instructions from './instructions.js';
import { EXTENSION_ID } from '@modelcontextprotocol/ext-apps/server';
import { registerConformanceFixtures } from './conformance-fixture-registration.js';
import { hasRegisteredUiExtensionResource } from './ui-extension-support.js';
import { getEnvironment } from './env.js';
import { metricsCollector } from './metrics.js';
import { engineLogger as logger } from './logger.js';
import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpToolDefinition,
  McpUserProfile,
} from './types/primitives.js';
import type { McpScope } from './scopes.js';

/**
 * The advertised server version comes from `package.json`'s own
 * `version`, not a hardcoded literal -- read lazily via `createRequire`
 * rather than a static `import ... from '../package.json'`, since a
 * static JSON import would resolve outside this package's
 * `rootDir: "src"` under `tsc --noEmit`. Memoized: the file never changes
 * at runtime, and every `createMcpServer` call would otherwise pay a
 * synchronous `fs` read.
 */
let cachedPackageVersion: string | undefined;
function readPackageVersion(): string {
  if (cachedPackageVersion === undefined) {
    const packageMetadata = createRequire(import.meta.url)('../package.json') as {
      version: string;
    };
    cachedPackageVersion = packageMetadata.version;
  }
  return cachedPackageVersion;
}

// A capability advertised here is a promise a connector is entitled to
// rely on. `sampling` and `elicitation` are not even real server
// capabilities (the wire schema has no such keys — they describe what a
// *client* offers a server, not the reverse; the server-to-client fixtures
// that use them work through `ctx.mcpReq.send`, which does not depend on
// the server's own `capabilities` object at all), `logging` has no
// `logging/setLevel` handler and no production caller of
// `notifications/message` outside the conformance fixtures, and neither
// `tools`, `resources`, nor `prompts` ever sends a `list_changed`
// notification, so `listChanged` is set to `false` explicitly rather than
// omitted — the SDK's `registerTool`/`registerResource`/`registerPrompt`
// each default an *unset* `listChanged` bit back to `true` the first time a
// primitive of that kind is registered, so leaving it out here would
// silently re-advertise the same lie this item removes.
function buildServerCapabilities(input: {
  enableConformanceMode: boolean;
  experimentalCapabilities: Record<string, { version: string }>;
  /**
   * `resources.subscribe` is genuinely implemented on the modern
   * (`2026-07-28`) era via the per-request factory's `subscriptions/listen`
   * stream — a consuming application wires its own per-user
   * `ServerEventBus` there (see `publishResourceUpdate` on
   * `createMcpServer`'s context below), which is what makes delivery
   * authorization-safe: each user's handler instance has its own event
   * bus, so a `notifications/resources/updated` push can never reach
   * another user's stream. The legacy (`2025-11-25`) era has no delivery
   * path — legacy serving is per-request and stateless, so there is no
   * long-lived session to push to — so it stays unadvertised there; a
   * legacy client's `resources/subscribe` call still gets a
   * spec-compliant ack (see the handler registration below), it just
   * never receives an update.
   */
  subscriptionsEnabled: boolean;
}): ServerCapabilities {
  return {
    tools: { listChanged: false },
    resources: { listChanged: false, ...(input.subscriptionsEnabled ? { subscribe: true } : {}) },
    prompts: { listChanged: false },
    experimental: input.experimentalCapabilities,
    // Conformance fixtures (registered only in conformance mode, never in
    // production) send `notifications/message` — the SDK throws
    // `CapabilityNotSupported` if a server does that without advertising
    // `logging`, so the conformance-only fixture path needs the real
    // capability, scoped to exactly the mode that uses it.
    ...(input.enableConformanceMode ? { logging: {} } : {}),
  };
}

/**
 * The JSON-RPC error code this server uses for an authenticated but
 * under-scoped `tools/call` / `resources/read` / `prompts/get` request.
 * JSON-RPC reserves `-32000` through `-32099` for implementation-defined
 * server errors; no MCP-spec-assigned code exists for "the token was
 * valid but lacked the scope this operation needs".
 *
 * This deliberately avoids `-32001`: verified directly against this
 * package's own installed dependencies (`@modelcontextprotocol/sdk@1.29.0`
 * and `@modelcontextprotocol/server@2.0.0` — check `bun.lock` for the
 * exact resolved versions currently in use). `@modelcontextprotocol/sdk`
 * (the client SDK real connectors embed) hard-codes
 * `ErrorCode.RequestTimeout = -32001` in its wire-facing `ErrorCode` enum
 * (`dist/esm/types.d.ts`) — a client using that SDK to talk to this server
 * would classify our insufficient-scope error as its own request having
 * timed out and could retry instead of surfacing the attached
 * `insufficient_scope` challenge. This package's own
 * `@modelcontextprotocol/server` dependency separately hard-codes `-32001`
 * for "Session not found" at several Streamable HTTP transport call sites
 * (`dist/index.mjs`) — a second, independent collision. `-32003` is
 * confirmed absent from every `.d.ts`/`.mjs`/`.cjs` file in both installed
 * packages as of this port; re-verify against whatever versions are
 * actually installed if this file is touched again, since both findings
 * are version-specific.
 */
const mcpInsufficientScopeErrorCode = -32003;

/**
 * The RFC 6750-shaped challenge this server attaches wherever a request
 * fails purely because the caller's token lacks `requiredScope` — as a
 * tool result's `_meta['mcp/www_authenticate']` (the SDK has no typed
 * `securitySchemes` field on `Tool` to attach this to instead; confirmed
 * against the installed `@modelcontextprotocol/server@2.0.0` type
 * definitions) and as `data` on the `ProtocolError` thrown for resources
 * and prompts, which have no error-result shape of their own to carry a
 * `_meta` object on.
 */
function insufficientScopeChallenge(requiredScope: McpScope): string {
  return `Bearer error="insufficient_scope", scope="${requiredScope}"`;
}

function hasRequiredScope(grantedScopes: readonly string[], requiredScope: McpScope): boolean {
  return grantedScopes.includes(requiredScope);
}

/**
 * `resources/read` rejects an under-scoped request via
 * `assertRequiredScope` before the handler ever runs, but the
 * `2026-07-28` `subscriptions/listen` stream (the push-notification path a
 * modern client uses to receive `notifications/resources/updated` for
 * `resourceSubscriptions: [uri, ...]`) never consults scopes at all — a
 * client holding only one scope could still subscribe to a resource that
 * requires a different one, and would receive a `resource_updated` event
 * the moment that resource actually changed despite never having been
 * granted access to read it. That is a real authorization bypass: it
 * leaks the *fact* that a scoped resource changed to a caller who was
 * never allowed to read its contents.
 *
 * Root cause of why this cannot simply reuse `assertRequiredScope`
 * in-place: the installed `@modelcontextprotocol/server@2.0.0` SDK serves
 * `subscriptions/listen` entirely outside the registered-handler dispatch
 * this factory wires up. Confirmed directly against the installed
 * package's own bundled `createMcpHandler`
 * (`node_modules/@modelcontextprotocol/server/dist/index.mjs`): on a
 * `subscriptions/listen` request it builds a FRESH server via the
 * factory, reads only `server.getCapabilities()` off it, immediately
 * calls `product.close()`, and hands the request to its own internal
 * `listenRouter.serve(...)` — the constructed `McpServer` instance (and
 * therefore anything registered on it, including `assertRequiredScope`'s
 * call sites) never sees the request at all, and the factory itself is
 * never even passed the requested `resourceSubscriptions` URIs to filter
 * against. There is consequently no request-handler hook inside
 * `createMcpServer` capable of enforcing this — the enforcement point has
 * to live at the HTTP boundary that owns the raw request body, before it
 * is ever handed to the SDK's own `fetch()`.
 *
 * This function is the reusable piece `createMcpServer` CAN own: the same
 * scope-lookup `assertRequiredScope` performs (grantedScopes vs. a
 * resource definition's `requiredScope`), applied per requested URI
 * against `allResources`, the single source of truth for which scope each
 * resource needs. A consuming application's own HTTP boundary is the
 * natural call site: peek the request body to detect a
 * `subscriptions/listen` call before dispatch, read
 * `params.notifications.resourceSubscriptions` off it, call this with the
 * caller's verified `scopes`, and refuse the WHOLE request (a single
 * JSON-RPC error, not a per-URI partial ack) when it returns `false`.
 *
 * Design decision — reject the whole request, not a filtered subset:
 * silently attaching only the permitted URIs while acking the rest would
 * (a) never inform the client which of its requested subscriptions it
 * actually got, and (b) let a caller distinguish "URI exists but I lack
 * scope" from "URI doesn't exist" by comparing which URIs it lists in an
 * absence-of-updates versus an outright rejection — a probe channel. A
 * single all-or-nothing rejection discloses nothing about which specific
 * URI(s) failed or why. Fails closed: an unrecognized URI is treated
 * identically to a recognized-but-under-scoped one (both deny), so denial
 * never confirms or denies a resource's existence either.
 */
export function areResourceSubscriptionsAuthorized(
  uris: readonly string[],
  scopes: readonly string[],
): boolean {
  return uris.every((uri) => {
    const resource = allResources.find((definition) => definition.uri === uri);
    return resource !== undefined && hasRequiredScope(scopes, resource.requiredScope);
  });
}

export function createMcpServer(context: {
  userId: string;
  user: McpUserProfile;
  /**
   * The HTTP-boundary request identifier, threaded through to every
   * tool/resource/prompt handler via `McpContext.requestId` so one
   * connector action can be traced end to end through logs. Undefined for
   * callers that build a server outside a real HTTP request (the
   * standalone conformance server, tests).
   */
  requestId?: string;
  enableUiExtension: boolean;
  enableConformanceMode?: boolean;
  /**
   * Which protocol era this particular `McpServer` instance will serve.
   * Drives whether `resources.subscribe` is advertised (only ever true on
   * `'modern'` — see `buildServerCapabilities`) — legacy serving has no
   * delivery path for a subscription push. Defaults to `'legacy'` so
   * existing callers (tests, the standalone conformance server) that do
   * not pass it keep today's unadvertised behavior.
   */
  era?: 'legacy' | 'modern';
  /**
   * Publishes a `notifications/resources/updated` event scoped to only
   * this context's `userId`. Undefined when no event bus is wired for
   * this request (e.g. the standalone conformance server) —
   * `resources/subscribe` still acks, it just never delivers.
   */
  publishResourceUpdate?: (uri: string) => Promise<void>;
  /**
   * The OAuth scopes the caller's access token actually carries, verified
   * by whatever HTTP boundary a consuming application builds before this
   * factory is ever called. Enforced here, once, before any
   * tool/resource/prompt handler runs — missing scopes fail before
   * application data is read.
   */
  scopes: readonly string[];
}): McpServer {
  const era = context.era ?? 'legacy';
  const enableConformanceMode =
    context.enableConformanceMode ?? getEnvironment().MCP_CONFORMANCE_MODE;
  const experimentalCapabilities: Record<string, { version: string }> = {};
  // Advertising the MCP Apps extension is not just gated on the
  // `enableUiExtension` flag (which a consuming application controls) —
  // it also requires at least one registered resource that is actually
  // an MCP App (`RESOURCE_MIME_TYPE`). `hasRegisteredUiExtensionResource()`
  // is the single source of truth for that predicate. This package ships
  // no default resources at all, so this mechanically keeps the
  // capability absent even if the flag is turned on by mistake, rather
  // than only relying on the default. Once a real resource with that
  // MIME type exists, this becomes true on its own with no further
  // change needed here.
  if (context.enableUiExtension && hasRegisteredUiExtensionResource()) {
    experimentalCapabilities[EXTENSION_ID] = { version: '1.0.0' };
  }

  // No `template-` (or any other) hardcoded literal default: an operator
  // that never sets `MCP_SERVER_NAME` gets a generic, honest identity
  // rather than a name inherited from wherever this package's engine
  // originated.
  const serverName = getEnvironment().MCP_SERVER_NAME ?? 'mcp-server';

  const server = new McpServer(
    {
      name: serverName,
      version: readPackageVersion(),
    },
    {
      instructions,
      capabilities: buildServerCapabilities({
        enableConformanceMode,
        experimentalCapabilities,
        subscriptionsEnabled: era === 'modern' && context.publishResourceUpdate !== undefined,
      }),
    },
  );

  function registerToolDefinition(tool: McpToolDefinition): void {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: tool.annotations,
        ...(tool._meta ? { _meta: tool._meta } : {}),
      },
      async (input, ctx) => {
        if (!hasRequiredScope(context.scopes, tool.requiredScope)) {
          // One of the outcomes an operator needs to be able to
          // distinguish. Logs the required scope, never the caller's
          // actual (insufficient) scope set or token.
          logger.warn(
            {
              event: 'mcp_tool_call',
              outcome: 'insufficient_scope',
              tool: tool.name,
              requiredScope: tool.requiredScope,
              userId: context.userId,
              requestId: context.requestId,
            },
            'MCP tool call rejected: insufficient scope',
          );
          metricsCollector.recordToolInvocation(tool.name, 0, true);
          metricsCollector.recordEvent('mcp_method', 'insufficient_scope');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Insufficient scope: this tool requires '${tool.requiredScope}'.`,
              },
            ],
            isError: true,
            _meta: { 'mcp/www_authenticate': insufficientScopeChallenge(tool.requiredScope) },
          };
        }

        const start = Date.now();
        // Thread the SDK's own per-request AbortSignal through so a
        // handler that awaits a cancellable operation genuinely stops
        // work on client disconnect/`notifications/cancelled`, instead
        // of only abandoning a wrapper promise.
        const result = await tool.handler(input as never, {
          ...context,
          signal: ctx.mcpReq.signal,
        });
        const isError = 'isError' in result && result.isError === true;
        metricsCollector.recordToolInvocation(tool.name, Date.now() - start, isError);
        if (isError) {
          // Distinct from `insufficient_scope` above (an authorization
          // decision made before the handler ever ran) — this is a
          // structured tool result the handler itself returned. Never
          // logs tool input/output — both can carry caller-supplied or
          // generated content.
          logger.warn(
            {
              event: 'mcp_tool_call',
              outcome: 'tool_failure',
              tool: tool.name,
              userId: context.userId,
              requestId: context.requestId,
            },
            'MCP tool call returned an error result',
          );
          metricsCollector.recordEvent('mcp_method', 'tool_failure');
        }
        return result;
      },
    );
  }

  for (const tool of allTools) {
    registerToolDefinition(tool);
  }

  /**
   * `resources/read` and `prompts/get` have no `isError` result variant
   * to answer an under-scoped request with (unlike `CallToolResult`
   * above), so an under-scoped request throws instead — the SDK turns a
   * thrown `ProtocolError` into a JSON-RPC error response carrying its
   * `data`, which is where the `_meta['mcp/www_authenticate']` challenge
   * lives for these two primitive kinds.
   */
  function assertRequiredScope(
    definition: Pick<McpResourceDefinition | McpPromptDefinition, 'name' | 'requiredScope'>,
  ): void {
    if (hasRequiredScope(context.scopes, definition.requiredScope)) return;
    throw new ProtocolError(
      mcpInsufficientScopeErrorCode,
      `Insufficient scope: '${definition.name}' requires '${definition.requiredScope}'.`,
      {
        requiredScope: definition.requiredScope,
        _meta: { 'mcp/www_authenticate': insufficientScopeChallenge(definition.requiredScope) },
      },
    );
  }

  for (const resource of allResources) {
    server.registerResource(
      resource.name,
      resource.uri,
      { title: resource.title, description: resource.description, mimeType: resource.mimeType },
      async (uri, ctx) => {
        assertRequiredScope(resource);
        return resource.handler(uri, { ...context, signal: ctx.mcpReq.signal });
      },
    );
  }

  for (const prompt of allPrompts) {
    const promptHandler = prompt.arguments
      ? async (arguments_: unknown, ctx: { mcpReq: { signal: AbortSignal } }) => {
          assertRequiredScope(prompt);
          return prompt.handler(arguments_ as never, { ...context, signal: ctx.mcpReq.signal });
        }
      : async (ctx: { mcpReq: { signal: AbortSignal } }) => {
          assertRequiredScope(prompt);
          return prompt.handler({} as never, { ...context, signal: ctx.mcpReq.signal });
        };
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        ...(prompt.arguments ? { argsSchema: prompt.arguments } : {}),
      },
      promptHandler as never,
    );
  }

  // `resources/subscribe` and `resources/unsubscribe` are always
  // registered (spec-compliant ack) because a low-level `Server` (unlike
  // `McpServer`'s auto-handling) is responsible for answering any method
  // it advertises a capability for, and — on the legacy era, or when the
  // era hasn't been told — the capability may be absent while a tolerant
  // client still probes the method. Real delivery happens entirely on
  // the `2026-07-28` `subscriptions/listen` stream, which the SDK's own
  // `createMcpHandler` serves against whatever per-user `ServerEventBus`
  // a consuming application constructs; there is no interest-tracking
  // bookkeeping left to do here — the SDK's own listen router filters
  // each stream to the URIs its own request opted into, and a per-user
  // bus means one user's published update is physically unreachable from
  // another user's stream. `resources/subscribe` itself does not need to
  // record anything for that to be true.
  //
  // Does this unconditional `{}` ack need the same scope check
  // `areResourceSubscriptionsAuthorized` (above) adds for the modern
  // `subscriptions/listen` path? No — deliberately checked and ruled
  // out, not merely overlooked. This handler exists ONLY for the legacy
  // (`2025-11-25`) era, and legacy serving is per-request and stateless:
  // there is no long-lived session for this era to push a
  // `resource_updated` notification onto, full stop, regardless of what
  // any legacy `resources/subscribe` call requested. An unconditional
  // `{}` ack that never leads to delivery leaks nothing an authorization
  // check could prevent — it doesn't even confirm the named URI
  // corresponds to a real resource, since it acks identically for any
  // input. The actual bypass `areResourceSubscriptionsAuthorized`
  // guards against lives exclusively on the modern path, where a
  // subscription genuinely can and does deliver events later.
  server.server.setRequestHandler('resources/subscribe', async () => ({}));
  server.server.setRequestHandler('resources/unsubscribe', async () => ({}));

  if (enableConformanceMode) {
    // Synthetic/protocol-only fixtures are registered here rather than
    // in `allTools`, so a production deployment — which never sets
    // `enableConformanceMode` — never advertises or serves them.
    for (const tool of conformanceOnlyTools) {
      registerToolDefinition(tool);
    }
    registerConformanceFixtures(server, context.publishResourceUpdate);
  }

  return server;
}
