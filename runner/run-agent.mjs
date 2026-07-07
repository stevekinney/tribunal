import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import {
  ALLOWED_AGENT_TOOLS,
  buildReviewPrompt,
  buildTriagePrompt,
  buildVerificationPrompt,
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
  exit = process.exit.bind(process),
  signalSource = process,
  queryClient = query,
  performanceNow = () => performance.now(),
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

  const startedAt = performanceNow();
  const repositoryPath = environment.TRIBUNAL_REPOSITORY_PATH ?? '/workspace/repository';
  const model = environment.TRIBUNAL_AGENT_MODEL ?? 'sonnet';
  const effort = environment.TRIBUNAL_AGENT_EFFORT || null;
  const maxBudgetUsd = parseMaxBudgetUsd(environment.TRIBUNAL_AGENT_MAX_BUDGET_USD);
  const role = parseAgentRole(environment.TRIBUNAL_AGENT_ROLE);
  const availableAgentSlugs = parseAvailableAgentSlugs(environment.TRIBUNAL_AVAILABLE_AGENT_SLUGS);
  const findingToVerify = parseFindingToVerify(environment.TRIBUNAL_FINDING_TO_VERIFY);
  // Keep SDK-required env, but replace any API key so traffic uses the scoped proxy token.
  // settingSources is set to [] and auto-memory is disabled below so no filesystem
  // settings or memory bleed across multi-tenant review sessions.
  const sdkEnvironment = {
    ...environment,
    ANTHROPIC_API_KEY: environment.TRIBUNAL_RUN_TOKEN,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
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
  const resultState = { written: false, promise: undefined };
  let latestSdkResult;
  let latestCollectedFindings = [];
  let terminationRequested = false;
  const removeTerminateListener = () => {
    const removeSignalListener = signalSource.off ?? signalSource.removeListener;
    removeSignalListener?.call(signalSource, 'SIGTERM', terminateListener);
  };

  emitEvent('session_start', { agentSlug, model, effort });
  const terminateListener = () => {
    terminationRequested = true;
    emitEvent('stop', { reason: 'terminated' });
    void writeResult(
      stdout,
      resultState,
      createResult({
        agentSlug,
        modelUsed: model,
        effortUsed: effort,
        sdkResult: latestSdkResult,
        findings: latestCollectedFindings,
        durationMs: elapsedMilliseconds(startedAt, performanceNow),
        error: 'Agent review stopped before completion.',
      }),
    )
      .catch(() => {})
      .finally(() => exit(143));
  };
  signalSource.once?.('SIGTERM', terminateListener);

  try {
    const result = await runClaudeReview({
      agentSlug,
      repositoryPath,
      model,
      effort,
      maxBudgetUsd,
      role,
      availableAgentSlugs,
      findingToVerify,
      agentDescription,
      agentBody,
      guidelines,
      diffContext,
      sdkEnvironment,
      startedAt,
      performanceNow,
      emitEvent,
      queryClient,
      onSdkResult: (sdkResult) => {
        latestSdkResult = sdkResult;
      },
      onCollectedFindings: (collectedFindings) => {
        latestCollectedFindings = collectedFindings;
      },
    });
    if (terminationRequested) return;
    removeTerminateListener();
    await writeResult(stdout, resultState, result);
  } catch (error) {
    removeTerminateListener();
    emitEvent('error', { message: error instanceof Error ? error.message : String(error) });
    const collectedFindings =
      error instanceof Error && Array.isArray(error.collectedFindings)
        ? error.collectedFindings
        : latestCollectedFindings;
    const result = createResult({
      agentSlug,
      modelUsed: model,
      effortUsed: effort,
      sdkResult: latestSdkResult,
      findings: collectedFindings,
      durationMs: elapsedMilliseconds(startedAt, performanceNow),
      error: error instanceof Error ? error.message : 'Agent review failed.',
    });
    await writeResult(stdout, resultState, result);
  } finally {
    removeTerminateListener();
  }
}

export async function runClaudeReview({
  agentSlug,
  repositoryPath,
  model,
  effort,
  maxBudgetUsd,
  role = 'specialist',
  availableAgentSlugs = [],
  findingToVerify,
  agentDescription,
  agentBody,
  guidelines,
  diffContext,
  sdkEnvironment,
  startedAt = performance.now(),
  performanceNow = () => performance.now(),
  emitEvent = () => {},
  onSdkResult = () => {},
  onCollectedFindings = () => {},
  queryClient = query,
  createMcpServer = createTribunalMcpServer,
  readGitObject = readGitObjectAtRevision,
}) {
  const prompt = buildRolePrompt({
    role,
    agentDescription,
    agentBody,
    diffContext,
    guidelines,
    availableAgentSlugs,
    findingToVerify,
  });
  const reviewTools = createTribunalReviewTools({
    diffContext,
    guidelines,
    readBaseFile: createGitBaseFileReader({ repositoryPath, diffContext, readGitObject }),
  });
  onCollectedFindings(reviewTools.record_finding.collectedFindings);
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
      env: sdkEnvironment,
      ...(effort ? { effort } : {}),
      ...(maxBudgetUsd !== undefined ? { maxBudgetUsd } : {}),
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
            input: redactToolInputForEvent(toolName, input),
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
      outputFormat: { type: 'json_schema', schema: outputSchemaForRole(role) },
    },
  });

  try {
    for await (const message of stream) {
      if (message.type === 'result') {
        sdkResult = message;
        onSdkResult(message);
      } else if (message.type === 'assistant') emitEvent('message', { uuid: message.uuid });
      else if (message.type === 'system') emitEvent('notification', { subtype: message.subtype });
    }
  } catch (error) {
    if (error instanceof Error) {
      error.collectedFindings = [...reviewTools.record_finding.collectedFindings];
    }
    throw error;
  }

  const baseResult = {
    agentSlug,
    modelUsed: model,
    effortUsed: effort,
    usage: normalizeUsage(sdkResult?.usage),
    costEstimateUsd: Number(sdkResult?.total_cost_usd ?? 0),
    durationMs: elapsedMilliseconds(startedAt, performanceNow),
  };

  if (role === 'triage') {
    return { ...baseResult, findings: [], triage: normalizeTriageDecision(sdkResult) };
  }
  if (role === 'verifier') {
    return { ...baseResult, findings: [], verification: normalizeVerificationDecision(sdkResult) };
  }

  const findings = Array.isArray(sdkResult?.structured_output?.findings)
    ? anchorFindings(sdkResult.structured_output.findings, diffContext).map(
        (finding) => finding.finding,
      )
    : [];
  const collectedFindings = reviewTools.record_finding.collectedFindings;

  return { ...baseResult, findings: deduplicateFindings([...collectedFindings, ...findings]) };
}

function buildRolePrompt({
  role,
  agentDescription,
  agentBody,
  diffContext,
  guidelines,
  availableAgentSlugs,
  findingToVerify,
}) {
  if (role === 'triage') {
    return buildTriagePrompt({ diffContext, guidelines, availableAgentSlugs });
  }
  if (role === 'verifier') {
    return buildVerificationPrompt({ diffContext, finding: findingToVerify });
  }
  return buildReviewPrompt({ agentDescription, agentBody, diffContext, guidelines });
}

function outputSchemaForRole(role) {
  if (role === 'triage') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['skip', 'reason', 'riskFlags'],
      properties: {
        skip: { type: 'boolean' },
        reason: { type: 'string' },
        riskFlags: { type: 'array', items: { type: 'string' } },
      },
    };
  }
  if (role === 'verifier') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['verified', 'note'],
      properties: {
        verified: { type: 'boolean' },
        note: { type: 'string' },
      },
    };
  }
  return {
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
  };
}

function normalizeTriageDecision(sdkResult) {
  const structured = sdkResult?.structured_output;
  return {
    skip: structured?.skip === true,
    reason: typeof structured?.reason === 'string' ? structured.reason : '',
    riskFlags: Array.isArray(structured?.riskFlags)
      ? structured.riskFlags.filter((flag) => typeof flag === 'string')
      : [],
  };
}

function normalizeVerificationDecision(sdkResult) {
  const structured = sdkResult?.structured_output;
  return {
    verified: structured?.verified === true,
    note: typeof structured?.note === 'string' ? structured.note : '',
  };
}

export async function writeResult(stdout, state, result) {
  if (state.written) return;
  if (state.promise) return state.promise;

  state.promise = new Promise((resolvePromise, rejectPromise) => {
    const removeErrorListener = () => {
      const removeListener = stdout.off ?? stdout.removeListener;
      removeListener?.call(stdout, 'error', handleError);
    };
    const handleError = (error) => {
      removeErrorListener();
      rejectPromise(error);
    };
    stdout.once?.('error', handleError);

    try {
      stdout.write(`${JSON.stringify({ type: 'result', result })}\n`, (error) => {
        removeErrorListener();
        if (error) {
          rejectPromise(error);
          return;
        }
        state.written = true;
        resolvePromise();
      });
    } catch (error) {
      removeErrorListener();
      rejectPromise(error);
    }
  }).finally(() => {
    state.promise = undefined;
  });

  return state.promise;
}

function createResult({
  agentSlug,
  modelUsed,
  effortUsed,
  sdkResult,
  findings = [],
  durationMs,
  error,
}) {
  return {
    agentSlug,
    findings: deduplicateFindings(findings),
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
    instructions:
      'Tribunal review tools. Use read-only tools to inspect context, and use record_finding to report findings.',
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

function redactToolInputForEvent(toolName, input) {
  if (toolName !== 'mcp__tribunal__record_finding' || !isRecord(input)) {
    return redactRuntimeValueForEvent(input);
  }

  const finding = isRecord(input.finding) ? input.finding : {};
  return redactRuntimeValueForEvent({
    ...input,
    finding: {
      ...finding,
      ...(typeof finding.title === 'string'
        ? { title: summarizeFindingTextForEvent(finding.title) }
        : {}),
      ...(typeof finding.body === 'string'
        ? { body: summarizeFindingTextForEvent(finding.body) }
        : {}),
      ...(typeof finding.suggestion === 'string'
        ? { suggestion: summarizeFindingTextForEvent(finding.suggestion) }
        : {}),
    },
  });
}

function summarizeFindingTextForEvent(value) {
  return `[redacted ${value.length} chars]`;
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

export function parseMaxBudgetUsd(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

// Inline string comparisons rather than a module-level `const` lookup Set:
// `main()` self-invokes from the very first statement in this file
// (`if (isMainModule()) await main();`), so keep this function's own logic
// self-contained rather than reaching for a shared module-level constant.
export function parseAgentRole(value) {
  return value === 'triage' || value === 'specialist' || value === 'verifier'
    ? value
    : 'specialist';
}

export function parseAvailableAgentSlugs(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((slug) => typeof slug === 'string') : [];
  } catch {
    return [];
  }
}

export function parseFindingToVerify(value) {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isAgentSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

function elapsedMilliseconds(startedAt, performanceNow = () => performance.now()) {
  return Math.max(0, Math.round(performanceNow() - startedAt));
}

export function isMainModule(
  moduleUrl = import.meta.url,
  argv = process.argv,
  cwd = process.cwd(),
) {
  const scriptPath = argv[1];
  return scriptPath !== undefined && moduleUrl === pathToFileURL(resolve(cwd, scriptPath)).href;
}
