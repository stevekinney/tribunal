import { agentResultSchema } from '@tribunal/review-core/schemas';
import type { AgentEvent, AgentResult, AgentSpec, DiffContext } from '@tribunal/review-core/types';
import type { RepoRef, SandboxOptions, SandboxPort } from '@tribunal/review-core/ports';
import { buildProxyOnlyEgressConfiguration, validateCloneInput } from './configuration';

export type SandboxCreateInput = {
  name: string;
  image: string;
  cpus: number;
  memoryMb: number;
  diskMb: number;
  timeoutSecs: number;
  allowInternetAccess: false;
  allowOut: string[];
  secretNames: [];
  env: Record<string, string>;
  metadata: Record<string, string>;
};

export type SandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SandboxAdapter = {
  create(input: SandboxCreateInput): Promise<{ sandboxId: string }>;
  runCommand(
    sandboxId: string,
    command: string,
    arguments_: string[],
    environment?: Record<string, string>,
  ): Promise<SandboxCommandResult>;
  runTrackedCommand(
    sandboxId: string,
    command: string,
    arguments_: string[],
    environment: Record<string, string> | undefined,
    onProcessStart: (processId: string) => Promise<void>,
    onStdoutLine?: (line: string) => void,
    signal?: AbortSignal,
  ): Promise<SandboxCommandResult>;
  killProcess(sandboxId: string, processId: string): Promise<void>;
  suspend(sandboxId: string): Promise<void>;
  terminate(sandboxId: string): Promise<void>;
};

export type SandboxPortConfiguration = {
  image: string;
  proxyUrl: string;
  proxyCidr: string;
  enablePromptCaching1h?: boolean;
};

/** Creates the review-core SandboxPort over a fakeable Tensorlake-style adapter. */
export function createSandboxPort(
  adapter: SandboxAdapter,
  configuration: SandboxPortConfiguration,
): SandboxPort {
  const runningAgentProcesses = new Map<string, { processId?: string; stopRequested: boolean }>();

  return {
    async ensure(prKey: string, options: SandboxOptions) {
      const egress = buildProxyOnlyEgressConfiguration(configuration);
      return adapter.create({
        name: prKey,
        image: configuration.image,
        cpus: 2,
        memoryMb: 4096,
        diskMb: 20_480,
        timeoutSecs: options.idleSuspendSeconds,
        ...egress,
        metadata: { managedBy: 'tribunal', name: prKey },
      });
    },
    async update(sandboxId: string, repository: RepoRef, head: string, runToken: string) {
      const proxiedRepositoryUrl = makeProxiedRepositoryUrl(configuration.proxyUrl, repository);
      const validation = validateCloneInput({ repositoryUrl: proxiedRepositoryUrl, headSha: head });
      if (!validation.ok) throw new Error(`invalid clone input: ${validation.reason}`);

      const commandResult = await adapter.runCommand(
        sandboxId,
        'bash',
        [
          '-lc',
          [
            'set -euo pipefail',
            'mkdir -p /workspace',
            'git_with_token() { git -c "http.extraHeader=Authorization: Bearer $TRIBUNAL_RUN_TOKEN" "$@"; }',
            'if [ -d /workspace/repository/.git ]; then',
            '  git_with_token -C /workspace/repository fetch origin "$TRIBUNAL_HEAD_SHA"',
            'else',
            '  git_with_token clone "$TRIBUNAL_REPOSITORY_URL" /workspace/repository',
            'fi',
            'git -C /workspace/repository checkout --detach "$TRIBUNAL_HEAD_SHA"',
          ].join('\n'),
        ],
        {
          TRIBUNAL_REPOSITORY_URL: proxiedRepositoryUrl,
          TRIBUNAL_HEAD_SHA: head,
          TRIBUNAL_RUN_TOKEN: runToken,
        },
      );
      if (commandResult.exitCode !== 0) {
        throw new Error(formatGitCommandFailure(commandResult));
      }
    },
    async runAgent(
      sandboxId: string,
      agent: AgentSpec,
      diffContext: DiffContext,
      runToken: string,
      onEvent: (event: AgentEvent) => void,
      signal: AbortSignal,
    ): Promise<AgentResult> {
      const agentRunId = getAgentRunId(agent);
      const processKey = createAgentProcessKey(sandboxId, agentRunId);
      const execution: { processId?: string; stopRequested: boolean } = { stopRequested: false };
      runningAgentProcesses.set(processKey, execution);
      let commandResult: SandboxCommandResult;
      let streamedEvents = false;
      try {
        commandResult = await adapter.runTrackedCommand(
          sandboxId,
          'node',
          ['runner/run-agent.mjs', agent.slug],
          {
            TRIBUNAL_RUN_TOKEN: runToken,
            TRIBUNAL_AGENT_RUN_ID: agentRunId,
            TRIBUNAL_PROXY_URL: configuration.proxyUrl,
            ANTHROPIC_BASE_URL: makeProxiedAnthropicUrl(configuration.proxyUrl),
            TRIBUNAL_AGENT_MODEL: agent.model,
            TRIBUNAL_DIFF_CONTEXT: JSON.stringify(diffContext),
            TRIBUNAL_CHANGED_FILES: JSON.stringify(
              diffContext.changedFiles.map((file) => file.path),
            ),
            ...(agent.effort ? { TRIBUNAL_AGENT_EFFORT: agent.effort } : {}),
            ...(configuration.enablePromptCaching1h ? { ENABLE_PROMPT_CACHING_1H: 'true' } : {}),
          },
          async (processId) => {
            execution.processId = processId;
            if (execution.stopRequested) {
              await adapter.killProcess(sandboxId, processId);
            }
          },
          (line) => {
            if (emitAgentEventLine(line, onEvent)) streamedEvents = true;
          },
          signal,
        );
      } finally {
        runningAgentProcesses.delete(processKey);
      }
      const parsedOutput = parseAgentRunnerOutput(commandResult.stdout, onEvent, {
        emitEvents: !streamedEvents,
      });
      if (commandResult.exitCode !== 0) {
        const error = formatAgentCommandFailure(commandResult);
        return parsedOutput.result === undefined
          ? createFailedAgentResult(agent, error)
          : withAgentResultError(parsedOutput.result, error);
      }
      if (parsedOutput.result !== undefined) return parsedOutput.result;
      return createFailedAgentResult(
        agent,
        parsedOutput.error ?? 'Agent runner did not produce a result record.',
      );
    },
    async stop(sandboxId: string, agentRunId: string) {
      const processKey = createAgentProcessKey(sandboxId, agentRunId);
      const execution = runningAgentProcesses.get(processKey);
      if (execution === undefined) return;
      execution.stopRequested = true;
      if (execution.processId !== undefined) {
        await adapter.killProcess(sandboxId, execution.processId);
      }
    },
    async suspend(sandboxId: string) {
      await adapter.suspend(sandboxId);
    },
    async terminate(sandboxId: string) {
      await adapter.terminate(sandboxId);
    },
  };
}

function getAgentRunId(agent: AgentSpec): string {
  const agentRunId = (agent as AgentSpec & { agentRunId?: unknown }).agentRunId;
  return typeof agentRunId === 'string' && agentRunId.length > 0 ? agentRunId : agent.id;
}

function parseAgentRunnerOutput(
  stdout: string,
  onEvent: (event: AgentEvent) => void,
  options: { emitEvents: boolean } = { emitEvents: true },
): { result?: AgentResult; error?: string } {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { error: 'Agent runner produced no output.' };
  }

  let result: AgentResult | undefined;
  let parseError: string | undefined;
  for (const line of lines) {
    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Agent runner output was not JSON.';
      continue;
    }
    const event = parseAgentEventRecord(record);
    if (event !== undefined) {
      if (options.emitEvents) onEvent(event);
      continue;
    }

    const resultRecord = parseAgentResultRecord(record);
    if (resultRecord !== undefined) {
      result = resultRecord;
      continue;
    }

    const parsedResult = agentResultSchema.safeParse(record);
    if (parsedResult.success) {
      result = parsedResult.data;
    }
  }

  if (result === undefined) {
    return { error: parseError ?? 'Agent runner did not produce a result record.' };
  }

  return { result };
}

function emitAgentEventLine(line: string, onEvent: (event: AgentEvent) => void): boolean {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0) return false;
  let record: unknown;
  try {
    record = JSON.parse(trimmedLine) as unknown;
  } catch {
    return false;
  }
  const event = parseAgentEventRecord(record);
  if (event === undefined) return false;
  onEvent(event);
  return true;
}

function parseAgentEventRecord(record: unknown): AgentEvent | undefined {
  if (isRecord(record) && record.type === 'event') {
    return parseAgentEvent(record.event);
  }
  return parseAgentEvent(record);
}

function parseAgentResultRecord(record: unknown): AgentResult | undefined {
  if (isRecord(record) && record.type === 'result') {
    const parsedResult = agentResultSchema.safeParse(record.result);
    return parsedResult.success ? parsedResult.data : undefined;
  }
  return undefined;
}

function parseAgentEvent(value: unknown): AgentEvent | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.agentRunId !== 'string') return undefined;
  if (typeof value.seq !== 'number') return undefined;
  if (typeof value.kind !== 'string') return undefined;
  if (typeof value.at !== 'string') return undefined;

  return {
    agentRunId: value.agentRunId,
    seq: value.seq,
    kind: value.kind as AgentEvent['kind'],
    ...(typeof value.tool === 'string' ? { tool: value.tool } : {}),
    ...(isRecord(value.detail) ? { detail: value.detail } : {}),
    at: value.at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function makeProxiedRepositoryUrl(proxyUrl: string, repository: RepoRef): string {
  const url = new URL(proxyUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/github/github.com/${repository.owner}/${repository.name}.git`;
  return url.toString();
}

function makeProxiedAnthropicUrl(proxyUrl: string): string {
  const url = new URL(proxyUrl);
  const prefix = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${prefix}/anthropic/api.anthropic.com`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function createAgentProcessKey(sandboxId: string, agentRunId: string): string {
  return `${sandboxId}:${agentRunId}`;
}

function createFailedAgentResult(agent: AgentSpec, error: string): AgentResult {
  return {
    agentSlug: agent.slug,
    findings: [],
    modelUsed: agent.model,
    effortUsed: agent.effort ?? null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    costEstimateUsd: 0,
    durationMs: 0,
    error,
  };
}

function withAgentResultError(result: AgentResult, error: string): AgentResult {
  return {
    ...result,
    error: result.error ?? error,
  };
}

function formatAgentCommandFailure(commandResult: SandboxCommandResult): string {
  const detail = commandResult.stderr || commandResult.stdout || 'agent runner produced no output';
  return `Agent runner failed with exit code ${commandResult.exitCode}: ${detail}`;
}

function formatGitCommandFailure(commandResult: SandboxCommandResult): string {
  const detail = commandResult.stderr || commandResult.stdout || 'git command produced no output';
  return `Sandbox repository update failed with exit code ${commandResult.exitCode}: ${detail}`;
}
