import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { mintCapabilityToken } from './capability-token';
import { parseProxyEnvironment } from './environment';
import { createProxyHandler } from './proxy';

const fixedNow = new Date('2026-06-17T12:00:00.000Z');
const signingKey = 'proxy-signing-key';
const anthropicApiKey = 'sk-ant-test-secret';

describe('runner and proxy integration', () => {
  it('passes the run token through the SDK Anthropic request without a 401', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tribunal-runner-proxy-'));
    const upstreamRequests: Request[] = [];
    const capabilityToken = mintCapabilityToken(
      {
        version: 1,
        runId: 'review-run-1',
        userId: 42,
        repositoryId: 1001,
        installationId: 2001,
        repositoryOwner: 'lostgradient',
        repositoryName: 'tribunal',
        permissions: ['github:read', 'anthropic:invoke'],
        expiresAtEpochSeconds: Math.floor(fixedNow.getTime() / 1000) + 60,
      },
      signingKey,
    );

    const handler = createProxyHandler({
      auditSink: async () => {},
      environment: parseProxyEnvironment({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
        REDIS_URL: 'redis://localhost:6379',
        GITHUB_APP_ID: '123',
        GITHUB_APP_PRIVATE_KEY: 'private-key',
        ANTHROPIC_API_KEY: anthropicApiKey,
        TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.test',
        TRIBUNAL_PROXY_CIDR: '10.0.0.10/32',
        PROXY_CA_CERT: '-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----',
        PROXY_SIGNING_KEY: signingKey,
        GITHUB_EGRESS_ALLOW: 'api.github.test,github.com',
        ANTHROPIC_EGRESS_ALLOW: 'api.anthropic.test',
      }),
      githubCredentialResolver: () => null,
      now: () => fixedNow,
      upstreamFetch: async (request) => {
        upstreamRequests.push(request);
        return Response.json({
          content: [{ type: 'text', text: JSON.stringify({ findings: [] }) }],
          id: 'msg_test',
          model: 'claude-test',
          role: 'assistant',
          stop_reason: 'end_turn',
          stop_sequence: null,
          type: 'message',
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    });
    const { closeServer, proxyUrl } = await startProxyServer(handler);

    try {
      const runnerPath = await createRunnerFixture(temporaryDirectory);
      const repositoryPath = join(temporaryDirectory, 'repository');
      await mkdir(repositoryPath);

      const subprocess = spawn('bun', [runnerPath, 'agent_security'], {
        cwd: temporaryDirectory,
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: `${proxyUrl}/anthropic/api.anthropic.test`,
          TRIBUNAL_AGENT_RUN_ID: 'agent-run-1',
          TRIBUNAL_REPOSITORY_PATH: repositoryPath,
          TRIBUNAL_RUN_TOKEN: capabilityToken,
        },
      });
      const [exitCodeResult, standardOutput, standardError] = await Promise.all([
        once(subprocess, 'exit'),
        readStream(subprocess.stdout),
        readStream(subprocess.stderr),
      ]);
      const [exitCode] = exitCodeResult;

      expect(exitCode, standardError).toBe(0);
      expect(standardOutput).toContain('"type":"result"');
      expect(upstreamRequests).toHaveLength(1);
      expect(upstreamRequests[0].headers.get('x-api-key')).toBe(anthropicApiKey);
      expect(upstreamRequests[0].headers.get('authorization')).toBeNull();
    } finally {
      await closeServer();
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});

async function createRunnerFixture(temporaryDirectory: string): Promise<string> {
  const runnerSource = await readFile(new URL('../../../runner/run-agent.mjs', import.meta.url));
  const runnerPath = join(temporaryDirectory, 'run-agent.mjs');
  const sdkPackageDirectory = join(
    temporaryDirectory,
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
  );
  const agentsPackageDirectory = join(temporaryDirectory, 'node_modules', '@tribunal', 'agents');

  await mkdir(sdkPackageDirectory, { recursive: true });
  await mkdir(agentsPackageDirectory, { recursive: true });
  await writeFile(runnerPath, runnerSource);
  await writeFile(
    join(sdkPackageDirectory, 'package.json'),
    JSON.stringify({ type: 'module', main: 'index.js' }),
  );
  await writeFile(
    join(sdkPackageDirectory, 'index.js'),
    [
      'export function query({ options }) {',
      '  return (async function* () {',
      '    const response = await fetch(`${options.env.ANTHROPIC_BASE_URL}/v1/messages`, {',
      "      method: 'POST',",
      "      headers: { 'content-type': 'application/json', 'x-api-key': options.env.ANTHROPIC_API_KEY },",
      '      body: JSON.stringify({ model: options.model, messages: [] }),',
      '    });',
      '    if (!response.ok) throw new Error(`Anthropic request failed with ${response.status}`);',
      "    yield { type: 'result', structured_output: { findings: [] }, usage: {}, total_cost_usd: 0 };",
      '  })();',
      '}',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(agentsPackageDirectory, 'package.json'),
    JSON.stringify({ type: 'module', main: 'index.js' }),
  );
  await writeFile(
    join(agentsPackageDirectory, 'index.js'),
    [
      'export const READ_ONLY_AGENT_TOOLS = [];',
      'export function enforceReadOnlyToolUse() {',
      "  return { permissionDecision: 'allow' };",
      '}',
      '',
    ].join('\n'),
  );

  return runnerPath;
}

async function startProxyServer(
  handler: (request: Request) => Promise<Response>,
): Promise<{ closeServer: () => Promise<void>; proxyUrl: string }> {
  const server = createServer(async (incomingRequest, serverResponse) => {
    const request = await createRequest(incomingRequest);
    const response = await handler(request);
    await writeResponse(serverResponse, response);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Proxy test server did not bind to a TCP port.');
  }

  return {
    closeServer: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    proxyUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function createRequest(incomingRequest: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of incomingRequest) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const headers = new Headers();
  for (const [header, value] of Object.entries(incomingRequest.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(header, item);
    } else if (value !== undefined) {
      headers.set(header, value);
    }
  }

  return new Request(`http://${incomingRequest.headers.host}${incomingRequest.url}`, {
    method: incomingRequest.method,
    headers,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
  });
}

async function writeResponse(serverResponse: ServerResponse, response: Response): Promise<void> {
  serverResponse.statusCode = response.status;
  response.headers.forEach((value, header) => serverResponse.setHeader(header, value));
  serverResponse.end(Buffer.from(await response.arrayBuffer()));
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
