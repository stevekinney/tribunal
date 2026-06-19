import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintCapabilityToken } from './capability-token';
import { parseProxyEnvironment } from './environment';
import { createProxyHandler } from './proxy';

const fixedNow = new Date('2026-06-17T12:00:00.000Z');
const signingKey = 'proxy-signing-key';
const anthropicApiKey = 'sk-ant-test-secret';
const runnerTimeoutMilliseconds = 5_000;

await runRunnerProxyIntegrationTest();

async function runRunnerProxyIntegrationTest(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'tribunal-runner-proxy-'));
  const upstreamRequests: Request[] = [];
  let closeServer = async () => {};
  let subprocess: ReturnType<typeof Bun.spawn> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
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

  try {
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
    const server = await startProxyServer(handler);
    closeServer = server.closeServer;
    const runnerPath = await createRunnerFixture(temporaryDirectory);
    const repositoryPath = join(temporaryDirectory, 'repository');
    await mkdir(repositoryPath);

    subprocess = Bun.spawn(['bun', runnerPath, 'agent-security'], {
      cwd: temporaryDirectory,
      env: {
        PATH: process.env.PATH ?? '',
        ANTHROPIC_BASE_URL: `${server.proxyUrl}/anthropic/api.anthropic.test`,
        TRIBUNAL_AGENT_RUN_ID: 'agent-run-1',
        TRIBUNAL_REPOSITORY_PATH: repositoryPath,
        TRIBUNAL_RUN_TOKEN: capabilityToken,
      },
      stderr: 'pipe',
      stdout: 'pipe',
    });
    const timeoutResult = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        subprocess?.kill();
        reject(new Error('Runner subprocess timed out.'));
      }, runnerTimeoutMilliseconds);
    });
    const exitCode = await Promise.race([subprocess.exited, timeoutResult]);
    const [standardOutput, standardError] = await Promise.all([
      readStream(subprocess.stdout),
      readStream(subprocess.stderr),
    ]);

    assert.equal(exitCode, 0, standardError);
    assert.match(standardOutput, /"type":"result"/u);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].headers.get('x-api-key'), anthropicApiKey);
    assert.equal(upstreamRequests[0].headers.get('authorization'), null);
  } finally {
    if (timeout) clearTimeout(timeout);
    subprocess?.kill();
    await subprocess?.exited.catch(() => {});
    await closeServer();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

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
  const reviewCorePackageDirectory = join(
    temporaryDirectory,
    'node_modules',
    '@tribunal',
    'review-core',
  );
  const zodPackageDirectory = join(temporaryDirectory, 'node_modules', 'zod');

  await mkdir(sdkPackageDirectory, { recursive: true });
  await mkdir(agentsPackageDirectory, { recursive: true });
  await mkdir(join(reviewCorePackageDirectory, 'redaction'), { recursive: true });
  await mkdir(zodPackageDirectory, { recursive: true });
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
      'export function createSdkMcpServer(server) { return server; }',
      'export function tool() { return {}; }',
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
      'export const ALLOWED_AGENT_TOOLS = [];',
      'export function buildReviewPrompt() { return "Review."; }',
      'export function createTribunalReviewTools() {',
      '  return {',
      '    get_changed_files: { description: "Return changed files.", execute: () => ({ changedFiles: [] }) },',
      '    read_base_file: { description: "Read base file.", execute: () => ({ contents: null }) },',
      '    get_pr_context: { description: "Return pull request context.", execute: () => ({ pullRequest: {} }) },',
      '    get_review_guidelines: { description: "Return guidelines.", execute: () => ({ guidelines: "" }) },',
      '    record_finding: { description: "Record finding.", collectedFindings: [], execute: () => ({ ok: true }) },',
      '  };',
      '}',
      'export function deduplicateFindings(findings) { return findings; }',
      'export function enforceReadOnlyToolUse() {',
      "  return { permissionDecision: 'allow' };",
      '}',
      'export function anchorFindings(findings) { return findings.map((finding) => ({ finding })); }',
      'export function isRepositoryRelativePath() { return true; }',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(reviewCorePackageDirectory, 'package.json'),
    JSON.stringify({
      type: 'module',
      exports: { './redaction': './redaction/index.js' },
    }),
  );
  await writeFile(
    join(reviewCorePackageDirectory, 'redaction', 'index.js'),
    'export function redactRuntimeValue(value) { return value; }\n',
  );
  await writeFile(
    join(zodPackageDirectory, 'package.json'),
    JSON.stringify({ type: 'module', exports: { './v4': './v4.js' } }),
  );
  await writeFile(
    join(zodPackageDirectory, 'v4.js'),
    [
      'const schema = {};',
      'export const z = {',
      '  string: () => schema,',
      '  unknown: () => schema,',
      '};',
      '',
    ].join('\n'),
  );

  return runnerPath;
}

async function startProxyServer(
  handler: (request: Request) => Promise<Response>,
): Promise<{ closeServer: () => Promise<void>; proxyUrl: string }> {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: handler,
  });

  return {
    closeServer: async () => {
      await server.stop(true);
    },
    proxyUrl: `http://127.0.0.1:${server.port}`,
  };
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return '';
  return new Response(stream).text();
}
