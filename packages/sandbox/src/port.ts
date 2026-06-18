import { agentResultSchema } from '@tribunal/review-core/schemas';
import type { AgentEvent, AgentResult, AgentSpec } from '@tribunal/review-core/types';
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
  ): Promise<SandboxCommandResult>;
  killProcess(sandboxId: string, processId: string): Promise<void>;
  suspend(sandboxId: string): Promise<void>;
  terminate(sandboxId: string): Promise<void>;
};

export type SandboxPortConfiguration = {
  image: string;
  proxyUrl: string;
  proxyCidr: string;
};

/** Creates the review-core SandboxPort over a fakeable Tensorlake-style adapter. */
export function createSandboxPort(
  adapter: SandboxAdapter,
  configuration: SandboxPortConfiguration,
): SandboxPort {
  const runningAgentProcesses = new Map<string, { processId?: string; stopRequested: boolean }>();

  return {
    async ensure(prKey: string, _options: SandboxOptions) {
      const egress = buildProxyOnlyEgressConfiguration(configuration);
      return adapter.create({
        name: prKey,
        image: configuration.image,
        cpus: 2,
        memoryMb: 4096,
        diskMb: 20_480,
        timeoutSecs: 900,
        ...egress,
        metadata: { managedBy: 'tribunal', name: prKey },
      });
    },
    async update(sandboxId: string, repository: RepoRef, head: string, runToken: string) {
      const sourceRepositoryUrl = makeCredentiallessRepositoryUrl(repository);
      const validation = validateCloneInput({ repositoryUrl: sourceRepositoryUrl, headSha: head });
      if (!validation.ok) throw new Error(`invalid clone input: ${validation.reason}`);
      const proxiedRepositoryUrl = makeProxiedRepositoryUrl(configuration.proxyUrl, repository);

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
      agentRunId: string,
      agent: AgentSpec,
      runToken: string,
      onEvent: (event: AgentEvent) => void,
      _signal: AbortSignal,
    ): Promise<AgentResult> {
      const processKey = createAgentProcessKey(sandboxId, agentRunId);
      const execution: { processId?: string; stopRequested: boolean } = { stopRequested: false };
      runningAgentProcesses.set(processKey, execution);
      let commandResult: SandboxCommandResult;
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
            ...(agent.effort ? { TRIBUNAL_AGENT_EFFORT: agent.effort } : {}),
          },
          async (processId) => {
            execution.processId = processId;
            if (execution.stopRequested) {
              await adapter.killProcess(sandboxId, processId);
            }
          },
        );
      } finally {
        runningAgentProcesses.delete(processKey);
      }
      if (commandResult.exitCode !== 0) {
        throw new Error(formatAgentCommandFailure(commandResult));
      }
      return parseAgentRunnerOutput(commandResult.stdout, onEvent);
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

function parseAgentRunnerOutput(stdout: string, onEvent: (event: AgentEvent) => void): AgentResult {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return agentResultSchema.parse(JSON.parse(stdout) as unknown);
  }

  let result: AgentResult | undefined;
  for (const line of lines) {
    const record = JSON.parse(line) as unknown;
    const event = parseAgentEventRecord(record);
    if (event !== undefined) {
      onEvent(event);
      continue;
    }

    const resultRecord = parseAgentResultRecord(record);
    if (resultRecord !== undefined) {
      result = resultRecord;
      continue;
    }

    result = agentResultSchema.parse(record);
  }

  if (result === undefined) {
    throw new Error('Agent runner did not produce a result record.');
  }

  return result;
}

function parseAgentEventRecord(record: unknown): AgentEvent | undefined {
  if (isRecord(record) && record.type === 'event') {
    return parseAgentEvent(record.event);
  }
  return parseAgentEvent(record);
}

function parseAgentResultRecord(record: unknown): AgentResult | undefined {
  if (isRecord(record) && record.type === 'result') {
    return agentResultSchema.parse(record.result);
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

function makeCredentiallessRepositoryUrl(repository: RepoRef): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

function makeProxiedRepositoryUrl(proxyUrl: string, repository: RepoRef): string {
  const url = new URL(proxyUrl);
  const prefix = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  url.pathname = `${prefix}/github/github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}.git`;
  url.search = '';
  url.hash = '';
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

function formatAgentCommandFailure(commandResult: SandboxCommandResult): string {
  const detail = commandResult.stderr || commandResult.stdout || 'agent runner produced no output';
  return `Agent runner failed with exit code ${commandResult.exitCode}: ${detail}`;
}

function formatGitCommandFailure(commandResult: SandboxCommandResult): string {
  const detail = commandResult.stderr || commandResult.stdout || 'git command produced no output';
  return `Sandbox repository update failed with exit code ${commandResult.exitCode}: ${detail}`;
}
