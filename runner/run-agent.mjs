import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ALLOWED_AGENT_TOOLS, enforceReadOnlyToolUse } from '@tribunal/agents';

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

emitEvent('session_start', { agentSlug, model, effort });

try {
  const result = await runClaudeReview({ agentSlug, repositoryPath, model, effort });
  process.stdout.write(`${JSON.stringify({ type: 'result', result })}\n`);
} catch (error) {
  emitEvent('error', { message: error instanceof Error ? error.message : String(error) });
  const result = createEmptyResult({
    agentSlug,
    modelUsed: model,
    effortUsed: effort,
    durationMs: elapsedMilliseconds(),
    error: error instanceof Error ? error.message : 'Agent review failed.',
  });
  process.stdout.write(`${JSON.stringify({ type: 'result', result })}\n`);
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
      ...(effort ? { maxThinkingTokens: effortToThinkingBudget(effort) } : {}),
      permissionMode: 'dontAsk',
      allowedTools: [...ALLOWED_AGENT_TOOLS],
      disallowedTools: ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
      canUseTool: async (toolName, input, options) => {
        const decision = enforceReadOnlyToolUse({
          toolName,
          input: isRecord(input) ? input : {},
          repositoryRoot: repositoryPath,
          diffContext,
        });
        const allowed = decision.permissionDecision === 'allow';
        emitEvent('tool_pre', {
          toolName,
          input,
          allowed,
          reason:
            decision.permissionDecision === 'deny' ? decision.reason : options.decisionReason,
        });
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
    if (message.type === 'result') sdkResult = message;
    else if (message.type === 'assistant') emitEvent('message', { uuid: message.uuid });
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

function createEmptyResult({ agentSlug, modelUsed, effortUsed, durationMs, error }) {
  return {
    agentSlug,
    findings: [],
    modelUsed,
    effortUsed,
    usage: normalizeUsage(),
    costEstimateUsd: 0,
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

function emitEvent(kind, detail = {}) {
  sequence += 1;
  process.stdout.write(
    `${JSON.stringify({
      type: 'event',
      event: {
        agentRunId: process.env.TRIBUNAL_AGENT_RUN_ID ?? 'unknown',
        seq: sequence,
        kind,
        detail,
        at: new Date().toISOString(),
      },
    })}\n`,
  );
}

function createDiffContext() {
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

function effortToThinkingBudget(value) {
  if (value === 'low') return 1_024;
  if (value === 'medium') return 4_096;
  if (value === 'high') return 8_192;
  if (value === 'xhigh') return 16_384;
  if (value === 'max') return 32_768;
  return undefined;
}
