import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import {
  ALLOWED_AGENT_TOOLS,
  buildReviewPrompt,
  createTribunalReviewTools,
  deduplicateFindings,
  enforceReadOnlyToolUse,
  anchorFindings,
  isRepositoryRelativePath,
} from '@tribunal/agents';
import { redactRuntimeValue } from '@tribunal/review-core/redaction';

if (isMainModule()) {
  await main();
}

export async function main({
  argv = process.argv,
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  exit = process.exit,
} = {}) {
  const [, , agentSlug] = argv;

  if (!agentSlug || !isAgentSlug(agentSlug)) {
    stderr.write('Missing or invalid agent slug.\n');
    exit(1);
    return;
  }

  if (!environment.TRIBUNAL_RUN_TOKEN) {
    stderr.write('Missing TRIBUNAL_RUN_TOKEN.\n');
    exit(1);
    return;
  }

  const resultPath = environment.TRIBUNAL_AGENT_RESULT_FILE;

  if (resultPath) {
    stdout.write(await readFile(resultPath, 'utf8'));
    exit(0);
    return;
  }

  const startedAt = performance.now();
  const repositoryPath = environment.TRIBUNAL_REPOSITORY_PATH ?? '/workspace/repository';
  const model = environment.TRIBUNAL_AGENT_MODEL ?? 'sonnet';
  const effort = environment.TRIBUNAL_AGENT_EFFORT || null;
  const agentDescription =
    environment.TRIBUNAL_AGENT_DESCRIPTION ?? `Tribunal review agent ${agentSlug}`;
  const agentBody =
    environment.TRIBUNAL_AGENT_BODY ??
    'Review the pull request for confirmed, actionable code review findings.';
  const guidelines =
    environment.TRIBUNAL_REVIEW_GUIDELINES ??
    'Report only confirmed findings. Do not approve, reject, or modify the pull request.';
  const diffContext = createDiffContext(environment);
  const emitEvent = createEventEmitter({ environment, stdout });
  const resultState = { written: false };
  let latestSdkResult;

  emitEvent('session_start', { agentSlug, model, effort });
  process.once('SIGTERM', () => {
    emitEvent('stop', { reason: 'terminated' });
    writeResult(
      stdout,
      resultState,
      createResult({
        agentSlug,
        modelUsed: model,
        effortUsed: effort,
        sdkResult: latestSdkResult,
        durationMs: elapsedMilliseconds(startedAt),
        error: 'Agent review stopped before completion.',
      }),
    );
    exit(143);
  });

  try {
    const result = await runClaudeReview({
      agentSlug,
      repositoryPath,
      model,
      effort,
      agentDescription,
      agentBody,
      guidelines,
      diffContext,
      startedAt,
      emitEvent,
      onSdkResult: (sdkResult) => {
        latestSdkResult = sdkResult;
      },
    });
    writeResult(stdout, resultState, result);
  } catch (error) {
    emitEvent('error', { message: error instanceof Error ? error.message : String(error) });
    const result = createResult({
      agentSlug,
      modelUsed: model,
      effortUsed: effort,
      sdkResult: latestSdkResult,
      durationMs: elapsedMilliseconds(startedAt),
      error: error instanceof Error ? error.message : 'Agent review failed.',
    });
    writeResult(stdout, resultState, result);
  }
}

export async function runClaudeReview({
  agentSlug,
  repositoryPath,
  model,
  effort,
  agentDescription,
  agentBody,
  guidelines,
  diffContext,
  startedAt = performance.now(),
  emitEvent = () => {},
  onSdkResult = () => {},
  queryClient = query,
  createMcpServer = createTribunalMcpServer,
  readGitObject = readGitObjectAtRevision,
}) {
  const prompt = buildReviewPrompt({
    agentDescription,
    agentBody,
    diffContext,
    guidelines,
  });
  const reviewTools = createTribunalReviewTools({
    diffContext,
    guidelines,
    readBaseFile: createGitBaseFileReader({ repositoryPath, diffContext, readGitObject }),
  });
  const tribunalMcpServer = createMcpServer(reviewTools);
  let sdkResult;

  const stream = queryClient({
    prompt,
    options: {
      agent: agentSlug,
      agents: {
        [agentSlug]: {
          description: agentDescription,
          prompt: agentBody,
          tools: [...ALLOWED_AGENT_TOOLS],
          model,
          ...(effort ? { effort } : {}),
          permissionMode: 'dontAsk',
        },
      },
      cwd: repositoryPath,
      model,
      ...(effort ? { effort } : {}),
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { tribunal: tribunalMcpServer },
      permissionMode: 'dontAsk',
      tools: [...ALLOWED_AGENT_TOOLS],
      allowedTools: [...ALLOWED_AGENT_TOOLS],
      disallowedTools: [
        'Bash',
        'Write',
        'Edit',
        'MultiEdit',
        'NotebookEdit',
        'WebFetch',
        'WebSearch',
      ],
      canUseTool: async (toolName, input, options) => {
        const decision = enforceReadOnlyToolUse({
          toolName,
          input: isRecord(input) ? input : {},
          repositoryRoot: repositoryPath,
          diffContext,
        });
        const allowed = decision.permissionDecision === 'allow';
        emitEvent(
          'tool_pre',
          {
            toolName,
            input: redactRuntimeValueForEvent(input),
            allowed,
            denied: !allowed,
            reason:
              decision.permissionDecision === 'deny' ? decision.reason : options.decisionReason,
          },
          toolName,
        );
        return allowed
          ? { behavior: 'allow', toolUseID: options.toolUseID }
          : {
              behavior: 'deny',
              message: decision.reason,
              toolUseID: options.toolUseID,
            };
      },
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['findings'],
          properties: {
            findings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'startLine', 'endLine', 'side', 'severity', 'title', 'body'],
                properties: {
                  path: { type: 'string' },
                  startLine: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
                  endLine: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
                  side: { enum: ['LEFT', 'RIGHT'] },
                  severity: { enum: ['info', 'warning', 'error'] },
                  title: { type: 'string' },
                  body: { type: 'string' },
                  suggestion: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  });

  for await (const message of stream) {
    if (message.type === 'result') {
      sdkResult = message;
      onSdkResult(message);
    } else if (message.type === 'assistant') emitEvent('message', { uuid: message.uuid });
    else if (message.type === 'system') emitEvent('notification', { subtype: message.subtype });
  }

  const findings = Array.isArray(sdkResult?.structured_output?.findings)
    ? anchorFindings(sdkResult.structured_output.findings, diffContext).map(
        (finding) => finding.finding,
      )
    : [];
  const collectedFindings = reviewTools.record_finding.collectedFindings;

  return {
    agentSlug,
    findings: deduplicateFindings([...collectedFindings, ...findings]),
    modelUsed: model,
    effortUsed: effort,
    usage: normalizeUsage(sdkResult?.usage),
    costEstimateUsd: Number(sdkResult?.total_cost_usd ?? 0),
    durationMs: elapsedMilliseconds(startedAt),
  };
}

function writeResult(stdout, state, result) {
  if (state.written) return;
  state.written = true;
  stdout.write(`${JSON.stringify({ type: 'result', result })}\n`);
}

function createResult({ agentSlug, modelUsed, effortUsed, sdkResult, durationMs, error }) {
  return {
    agentSlug,
    findings: [],
    modelUsed,
    effortUsed,
    usage: normalizeUsage(sdkResult?.usage),
    costEstimateUsd: Number(sdkResult?.total_cost_usd ?? 0),
    durationMs,
    ...(error ? { error } : {}),
  };
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(usage.cache_creation_input_tokens ?? 0),
  };
}

function createEventEmitter({ environment, stdout }) {
  let sequence = 0;

  return (kind, detail = {}, tool) => {
    sequence += 1;
    stdout.write(
      `${JSON.stringify({
        type: 'event',
        event: {
          agentRunId: environment.TRIBUNAL_AGENT_RUN_ID ?? 'unknown',
          seq: sequence,
          kind,
          ...(tool ? { tool } : {}),
          detail: redactRuntimeValueForEvent(detail),
          at: new Date().toISOString(),
        },
      })}\n`,
    );
  };
}

export function createTribunalMcpServer(
  reviewTools,
  { createServer = createSdkMcpServer, defineTool = tool } = {},
) {
  return createServer({
    name: 'tribunal',
    version: '0.0.1',
    instructions: 'Read-only Tribunal review tools. Use record_finding to report findings.',
    tools: [
      defineTool(
        'get_changed_files',
        reviewTools.get_changed_files.description,
        {},
        async () => toToolResult(reviewTools.get_changed_files.execute({})),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      defineTool(
        'read_base_file',
        reviewTools.read_base_file.description,
        { path: z.string() },
        async (input) => toToolResult(reviewTools.read_base_file.execute(input)),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      defineTool(
        'get_pr_context',
        reviewTools.get_pr_context.description,
        {},
        async () => toToolResult(reviewTools.get_pr_context.execute({})),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      defineTool(
        'get_review_guidelines',
        reviewTools.get_review_guidelines.description,
        {},
        async () => toToolResult(reviewTools.get_review_guidelines.execute({})),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      defineTool(
        'record_finding',
        reviewTools.record_finding.description,
        { finding: z.unknown() },
        async (input) => toToolResult(reviewTools.record_finding.execute(input)),
        { annotations: { readOnlyHint: false }, alwaysLoad: true },
      ),
    ],
  });
}

function toToolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

export function redactRuntimeValueForEvent(value) {
  return redactRuntimeValue(value);
}

export function createGitBaseFileReader({
  repositoryPath,
  diffContext,
  readGitObject = readGitObjectAtRevision,
}) {
  const changedFilePaths = new Set(diffContext.changedFiles.map((file) => file.path));

  return (filePath) => {
    if (!isRepositoryRelativePath(filePath)) return null;
    if (!changedFilePaths.has(filePath)) return null;
    if (!isGitObjectId(diffContext.baseSha)) return null;

    return readGitObject(repositoryPath, diffContext.baseSha, filePath);
  };
}

function readGitObjectAtRevision(repositoryPath, revision, filePath) {
  try {
    return execFileSync('git', ['-C', repositoryPath, 'show', `${revision}:${filePath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function isGitObjectId(value) {
  return /^[0-9a-f]{7,64}$/iu.test(value);
}

function createDiffContext(environment) {
  const parsedDiffContext = parseDiffContext(environment);
  if (parsedDiffContext !== null) return parsedDiffContext;

  const changedFiles = parseChangedFiles(environment);
  return {
    headSha: environment.TRIBUNAL_HEAD_SHA ?? 'unknown',
    baseSha: environment.TRIBUNAL_BASE_SHA ?? 'unknown',
    changedFiles: changedFiles.map((path) => ({
      path,
      status: 'modified',
      commentableLines: [],
    })),
    pr: {
      number: Number(environment.TRIBUNAL_PULL_REQUEST_NUMBER ?? 0),
      title: '',
      body: '',
      labels: [],
      author: '',
    },
  };
}

function parseDiffContext(environment) {
  try {
    const parsed = JSON.parse(environment.TRIBUNAL_DIFF_CONTEXT ?? 'null');
    if (!isRecord(parsed)) return null;
    if (!Array.isArray(parsed.changedFiles)) return null;
    if (!isRecord(parsed.pr)) return null;

    return {
      headSha: typeof parsed.headSha === 'string' ? parsed.headSha : 'unknown',
      baseSha: typeof parsed.baseSha === 'string' ? parsed.baseSha : 'unknown',
      ...(typeof parsed.prevHeadSha === 'string' ? { prevHeadSha: parsed.prevHeadSha } : {}),
      changedFiles: parsed.changedFiles.map(normalizeChangedFile).filter(Boolean),
      ...(Array.isArray(parsed.changedSinceLast)
        ? { changedSinceLast: parsed.changedSinceLast.map(normalizeChangedFile).filter(Boolean) }
        : {}),
      pr: {
        number: typeof parsed.pr.number === 'number' ? parsed.pr.number : 0,
        title: typeof parsed.pr.title === 'string' ? parsed.pr.title : '',
        body: typeof parsed.pr.body === 'string' ? parsed.pr.body : '',
        labels: Array.isArray(parsed.pr.labels)
          ? parsed.pr.labels.filter((label) => typeof label === 'string')
          : [],
        author: typeof parsed.pr.author === 'string' ? parsed.pr.author : '',
      },
    };
  } catch {
    return null;
  }
}

function normalizeChangedFile(value) {
  if (!isRecord(value) || typeof value.path !== 'string') return null;
  return {
    path: value.path,
    status: normalizeChangedFileStatus(value.status),
    ...(typeof value.patch === 'string' ? { patch: value.patch } : {}),
    commentableLines: Array.isArray(value.commentableLines)
      ? value.commentableLines.map(normalizeCommentableLine).filter(Boolean)
      : [],
  };
}

function normalizeChangedFileStatus(value) {
  return ['added', 'modified', 'removed', 'renamed'].includes(value) ? value : 'modified';
}

function normalizeCommentableLine(value) {
  if (!isRecord(value)) return null;
  if (value.side !== 'LEFT' && value.side !== 'RIGHT') return null;
  if (!Number.isInteger(value.line) || value.line < 1) return null;
  return { side: value.side, line: value.line };
}

function parseChangedFiles(environment) {
  try {
    const parsed = JSON.parse(environment.TRIBUNAL_CHANGED_FILES ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((path) => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAgentSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function elapsedMilliseconds(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export function isMainModule(
  moduleUrl = import.meta.url,
  argv = process.argv,
  cwd = process.cwd(),
) {
  const scriptPath = argv[1];
  return scriptPath !== undefined && moduleUrl === pathToFileURL(resolve(cwd, scriptPath)).href;
}
