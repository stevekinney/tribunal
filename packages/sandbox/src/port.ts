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
    async update(sandboxId: string, repository: RepoRef, head: string, _runToken: string) {
      const repositoryUrl = makeCredentiallessRepositoryUrl(repository);
      const validation = validateCloneInput({ repositoryUrl, headSha: head });
      if (!validation.ok) throw new Error(`invalid clone input: ${validation.reason}`);

      await adapter.runCommand(sandboxId, 'git', [
        '-c',
        `http.proxy=${configuration.proxyUrl}`,
        'clone-or-fetch',
        repositoryUrl,
        head,
      ]);
    },
    async runAgent(
      sandboxId: string,
      agentRunId: string,
      agent: AgentSpec,
      runToken: string,
      _onEvent: (event: AgentEvent) => void,
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
          { TRIBUNAL_RUN_TOKEN: runToken },
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
      const parsedOutput = JSON.parse(commandResult.stdout) as unknown;
      return agentResultSchema.parse(parsedOutput);
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

function makeCredentiallessRepositoryUrl(repository: RepoRef): string {
  return `https://github.com/${repository.owner}/${repository.name}.git`;
}

function createAgentProcessKey(sandboxId: string, agentRunId: string): string {
  return `${sandboxId}:${agentRunId}`;
}
