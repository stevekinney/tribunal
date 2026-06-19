import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import {
  ALLOWED_AGENT_TOOLS,
  buildReviewPrompt,
  createTribunalReviewTools,
  deduplicateFindings,
  enforceReadOnlyToolUse,
  anchorFindings,
} from '@tribunal/agents';
import { redactRuntimeRecord } from '@tribunal/review-core/redaction';

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
const agentDescription =
  process.env.TRIBUNAL_AGENT_DESCRIPTION ?? `Tribunal review agent ${agentSlug}`;
const agentBody =
  process.env.TRIBUNAL_AGENT_BODY ??
  'Review the pull request for confirmed, actionable code review findings.';
const guidelines =
  process.env.TRIBUNAL_REVIEW_GUIDELINES ??
  'Report only confirmed findings. Do not approve, reject, or modify the pull request.';
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
  const prompt = buildReviewPrompt({
    agentDescription,
    agentBody,
    diffContext,
    guidelines,
  });
  const reviewTools = createTribunalReviewTools({ diffContext, guidelines });
  const tribunalMcpServer = createTribunalMcpServer(reviewTools);
  let sdkResult;

  const stream = query({
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
      latestSdkResult = message;
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
        detail: redactRuntimeValueForEvent(detail),
        at: new Date().toISOString(),
      },
    })}\n`,
  );
}

function createTribunalMcpServer(reviewTools) {
  return createSdkMcpServer({
    name: 'tribunal',
    version: '0.0.1',
    instructions: 'Read-only Tribunal review tools. Use record_finding to report findings.',
    tools: [
      tool(
        'get_changed_files',
        reviewTools.get_changed_files.description,
        {},
        async () => toToolResult(reviewTools.get_changed_files.execute({})),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      tool(
        'read_base_file',
        reviewTools.read_base_file.description,
        { path: z.string() },
        async (input) => toToolResult(reviewTools.read_base_file.execute(input)),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      tool(
        'get_pr_context',
        reviewTools.get_pr_context.description,
        {},
        async () => toToolResult(reviewTools.get_pr_context.execute({})),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      tool(
        'get_review_guidelines',
        reviewTools.get_review_guidelines.description,
        {},
        async () => toToolResult(reviewTools.get_review_guidelines.execute({})),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
      tool(
        'record_finding',
        reviewTools.record_finding.description,
        { finding: z.unknown() },
        async (input) => toToolResult(reviewTools.record_finding.execute(input)),
        { annotations: { readOnlyHint: true }, alwaysLoad: true },
      ),
    ],
  });
}

function toToolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function redactRuntimeValueForEvent(value) {
  return isRecord(value) ? redactRuntimeRecord(value) : value;
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
