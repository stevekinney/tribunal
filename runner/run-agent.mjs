import { readFile } from 'node:fs/promises';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { READ_ONLY_AGENT_TOOLS, enforceReadOnlyToolUse } from '@tribunal/agents';

const allowedEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

if (isMainModule(import.meta.url, process.argv[1])) {
  await runAgentProcess();
}

export async function runAgentProcess({
  argv = process.argv,
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  exit = process.exit.bind(process),
  signalSource = process,
  queryFunction = query,
  performanceNow = () => performance.now(),
} = {}) {
  const [, , agentSlug] = argv;

  if (!agentSlug) {
    stderr.write('Missing agent slug.\n');
    exit(1);
    return;
  }

  if (!environment.TRIBUNAL_RUN_TOKEN) {
    stderr.write('Missing TRIBUNAL_RUN_TOKEN.\n');
    exit(1);
    return;
  }

  const resultPath = environment.TRIBUNAL_AGENT_RESULT_FILE;
  if (resultPath && environment.NODE_ENV === 'test') {
    stdout.write(await readFile(resultPath, 'utf8'));
    exit(0);
    return;
  }

  const startedAt = performanceNow();
  const context = {
    agentRunId: environment.TRIBUNAL_AGENT_RUN_ID ?? 'unknown',
    sequence: 0,
    stdout,
  };
  const repositoryPath = environment.TRIBUNAL_REPOSITORY_PATH ?? '/workspace/repository';
  const model = environment.TRIBUNAL_AGENT_MODEL ?? 'sonnet';
  const effort = environment.TRIBUNAL_AGENT_EFFORT || null;
  const diffContext = createDiffContext(environment);
  let latestSdkResult;
  let resultWritten = false;
  const elapsedMilliseconds = () => Math.max(0, Math.round(performanceNow() - startedAt));
  const writeOnce = (result) => {
    if (resultWritten) return;
    resultWritten = true;
    writeResult(stdout, result);
  };

  emitEvent(context, 'session_start', { agentSlug, model, effort });
  signalSource.once?.('SIGTERM', () => {
    emitEvent(context, 'stop', { reason: 'terminated' });
    writeOnce(
      createResult({
        agentSlug,
        modelUsed: resolveModelUsed(model, latestSdkResult),
        effortUsed: resolveEffortUsed(effort, latestSdkResult),
        sdkResult: latestSdkResult,
        durationMs: elapsedMilliseconds(),
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
      diffContext,
      queryFunction,
      emitEvent: (kind, detail, tool) => emitEvent(context, kind, detail, tool),
      setLatestSdkResult: (sdkResult) => {
        latestSdkResult = sdkResult;
      },
      elapsedMilliseconds,
    });
    writeOnce(result);
  } catch (error) {
    emitEvent(context, 'error', { message: error instanceof Error ? error.message : String(error) });
    writeOnce(
      createResult({
        agentSlug,
        modelUsed: resolveModelUsed(model, latestSdkResult),
        effortUsed: resolveEffortUsed(effort, latestSdkResult),
        sdkResult: latestSdkResult,
        durationMs: elapsedMilliseconds(),
        error: error instanceof Error ? error.message : 'Agent review failed.',
      }),
    );
  }
}

export async function runClaudeReview({
  agentSlug,
  repositoryPath,
  model,
  effort,
  diffContext,
  queryFunction = query,
  emitEvent = () => {},
  setLatestSdkResult = () => {},
  elapsedMilliseconds = () => 0,
}) {
  const prompt = [
    'Review this pull request from the checked-out repository.',
    'Return only structured findings. Do not modify files. Do not run shell commands.',
    'Each finding must include path, startLine, endLine, side, severity, title, body, and optional suggestion.',
  ].join('\n');
  let sdkResult;

  const stream = queryFunction({
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
      setLatestSdkResult(message);
    } else if (message.type === 'assistant') emitEvent('message', { uuid: message.uuid });
    else if (message.type === 'system') emitEvent('notification', { subtype: message.subtype });
  }

  const findings = Array.isArray(sdkResult?.structured_output?.findings)
    ? sdkResult.structured_output.findings
    : [];

  return {
    agentSlug,
    findings,
    modelUsed: resolveModelUsed(model, sdkResult),
    effortUsed: resolveEffortUsed(effort, sdkResult),
    usage: normalizeUsage(sdkResult?.usage),
    costEstimateUsd: Number(sdkResult?.total_cost_usd ?? 0),
    durationMs: elapsedMilliseconds(),
  };
}

export function createResult({ agentSlug, modelUsed, effortUsed, sdkResult, durationMs, error }) {
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

export function writeResult(stdout, result) {
  stdout.write(`${JSON.stringify({ type: 'result', result })}\n`);
}

export function resolveModelUsed(requestedModel, sdkResult) {
  const modelId = getNestedString(sdkResult, ['modelUsage', 'model_id']);
  return modelId ?? requestedModel;
}

export function resolveEffortUsed(requestedEffort, sdkResult) {
  const effort = getNestedString(sdkResult, ['modelUsage', 'effort']);
  return effort && allowedEfforts.has(effort) ? effort : requestedEffort;
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cacheReadTokens: Number(usage.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(usage.cache_creation_input_tokens ?? 0),
  };
}

export function emitEvent(context, kind, detail = {}, tool) {
  context.sequence += 1;
  context.stdout.write(
    `${JSON.stringify({
      type: 'event',
      event: {
        agentRunId: context.agentRunId,
        seq: context.sequence,
        kind,
        ...(tool ? { tool } : {}),
        detail,
        at: new Date().toISOString(),
      },
    })}\n`,
  );
}

function createDiffContext(environment = process.env) {
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

function getNestedString(value, path) {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

function isMainModule(moduleUrl, scriptPath) {
  if (!scriptPath) return false;
  return moduleUrl === new URL(scriptPath, 'file:').href;
}
