import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { READ_ONLY_AGENT_TOOLS, enforceReadOnlyToolUse } from '@tribunal/agents';

const [, , agentSlug] = process.argv;

if (!agentSlug) {
  console.error('Missing agent slug.');
  process.exit(1);
}

if (!process.env.TRIBUNAL_RUN_TOKEN) {
  console.error('Missing TRIBUNAL_RUN_TOKEN.');
  process.exit(1);
}

const startedAt = performance.now();
const resultPath = process.env.TRIBUNAL_AGENT_RESULT_FILE;

if (resultPath) {
  process.stdout.write(await readFile(resultPath, 'utf8'));
  process.exit(0);
}

const repositoryPath = process.env.TRIBUNAL_REPOSITORY_PATH ?? '/workspace/repository';
const model = process.env.TRIBUNAL_AGENT_MODEL ?? 'sonnet';
const effort = process.env.TRIBUNAL_AGENT_EFFORT || null;
const diffContext = createDiffContext();
let sequence = 0;
let latestSdkResult;
let resultWritten = false;

emitEvent('session_start', { agentSlug, model, effort });
process.once('SIGTERM', () => {
  emitEvent('stop', { reason: 'terminated' });
  writeResult(
    createResult({
      agentSlug,
      modelUsed: model,
      effortUsed: effort,
      sdkResult: latestSdkResult,
      durationMs: elapsedMilliseconds(),
      error: 'Agent review stopped before completion.',
    }),
  );
  process.exit(143);
});

try {
  const result = await runClaudeReview({ agentSlug, repositoryPath, model, effort });
  writeResult(result);
} catch (error) {
  emitEvent('error', { message: error instanceof Error ? error.message : String(error) });
  const result = createResult({
    agentSlug,
    modelUsed: model,
    effortUsed: effort,
    sdkResult: latestSdkResult,
    durationMs: elapsedMilliseconds(),
    error: error instanceof Error ? error.message : 'Agent review failed.',
  });
  writeResult(result);
}

async function runClaudeReview({ agentSlug, repositoryPath, model, effort }) {
  const prompt = [
    'Review this pull request from the checked-out repository.',
    'Return only structured findings. Do not modify files. Do not run shell commands.',
    'Each finding must include path, startLine, endLine, side, severity, title, body, and optional suggestion.',
  ].join('\n');
  let sdkResult;

  const stream = query({
    prompt,
    options: {
      cwd: repositoryPath,
      model,
      ...(effort ? { effort } : {}),
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
      permissionMode: 'dontAsk',
      allowedTools: [...READ_ONLY_AGENT_TOOLS],
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
            input,
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
      latestSdkResult = message;
    } else if (message.type === 'assistant') emitEvent('message', { uuid: message.uuid });
    else if (message.type === 'system') emitEvent('notification', { subtype: message.subtype });
  }

  const findings = Array.isArray(sdkResult?.structured_output?.findings)
    ? sdkResult.structured_output.findings
    : [];

  return {
    agentSlug,
    findings,
    modelUsed: model,
    effortUsed: effort,
    usage: normalizeUsage(sdkResult?.usage),
    costEstimateUsd: Number(sdkResult?.total_cost_usd ?? 0),
    durationMs: elapsedMilliseconds(),
  };
}

function writeResult(result) {
  if (resultWritten) return;
  resultWritten = true;
  process.stdout.write(`${JSON.stringify({ type: 'result', result })}\n`);
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

function emitEvent(kind, detail = {}, tool) {
  sequence += 1;
  process.stdout.write(
    `${JSON.stringify({
      type: 'event',
      event: {
        agentRunId: process.env.TRIBUNAL_AGENT_RUN_ID ?? 'unknown',
        seq: sequence,
        kind,
        ...(tool ? { tool } : {}),
        detail,
        at: new Date().toISOString(),
      },
    })}\n`,
  );
}

function createDiffContext() {
  const parsedDiffContext = parseDiffContext();
  if (parsedDiffContext !== null) return parsedDiffContext;

  const changedFiles = parseChangedFiles();
  return {
    headSha: process.env.TRIBUNAL_HEAD_SHA ?? 'unknown',
    baseSha: process.env.TRIBUNAL_BASE_SHA ?? 'unknown',
    changedFiles: changedFiles.map((path) => ({
      path,
      status: 'modified',
      commentableLines: [],
    })),
    pr: {
      number: Number(process.env.TRIBUNAL_PULL_REQUEST_NUMBER ?? 0),
      title: '',
      body: '',
      labels: [],
      author: '',
    },
  };
}

function parseDiffContext() {
  try {
    const parsed = JSON.parse(process.env.TRIBUNAL_DIFF_CONTEXT ?? 'null');
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

function parseChangedFiles() {
  try {
    const parsed = JSON.parse(process.env.TRIBUNAL_CHANGED_FILES ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((path) => typeof path === 'string') : [];
  } catch {
    return [];
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function elapsedMilliseconds() {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
