import { describe, expect, it } from 'vitest';
import type { AgentResult } from '@tribunal/review-core/types';
import { createSandboxPort, type SandboxAdapter, type SandboxCreateInput } from './port';

const result: AgentResult = {
  agentSlug: 'security-reviewer',
  findings: [],
  modelUsed: 'claude-sonnet-4-6',
  effortUsed: 'high',
  usage: {
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  },
  costEstimateUsd: 0.01,
  durationMs: 100,
};

function createFakeAdapter() {
  const calls: Array<{ method: string; input: unknown }> = [];
  const adapter: SandboxAdapter = {
    async create(input: SandboxCreateInput) {
      calls.push({ method: 'create', input });
      return { sandboxId: 'sandbox_1' };
    },
    async runCommand(sandboxId, command, arguments_) {
      calls.push({ method: 'runCommand', input: { sandboxId, command, arguments_ } });
      return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
    },
    async runTrackedCommand(sandboxId, command, arguments_, _environment, onProcessStart) {
      calls.push({ method: 'runTrackedCommand', input: { sandboxId, command, arguments_ } });
      await onProcessStart('123');
      return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
    },
    async killProcess(sandboxId, processId) {
      calls.push({ method: 'killProcess', input: { sandboxId, processId } });
    },
    async suspend(sandboxId) {
      calls.push({ method: 'suspend', input: { sandboxId } });
    },
    async terminate(sandboxId) {
      calls.push({ method: 'terminate', input: { sandboxId } });
    },
  };

  return { adapter, calls };
}

describe('sandbox port', () => {
  it('creates sandboxes with proxy-only egress configuration', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await port.ensure('tribunal-pr-42-7', { image: 'ignored', proxyUrl: 'ignored' });

    expect(calls[0]).toMatchObject({
      method: 'create',
      input: {
        name: 'tribunal-pr-42-7',
        image: 'tribunal-reviewer:latest',
        allowInternetAccess: false,
        allowOut: ['10.0.0.8/32'],
        secretNames: [],
      },
    });
  });

  it('uses credential-less clone and proxy configuration for updates', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await port.update(
      'sandbox_1',
      { owner: 'stevekinney', name: 'tribunal' },
      'a'.repeat(40),
      'capability-token',
    );

    expect(calls[0]).toMatchObject({ method: 'runCommand' });
    const commandArguments = (calls[0]?.input as { arguments_: string[] }).arguments_;
    expect(commandArguments.join(' ')).toContain('http.proxy=https://proxy.tribunal.local');
    expect(commandArguments.join(' ')).toContain('https://github.com/stevekinney/tribunal.git');
    expect(commandArguments.join(' ')).not.toContain('capability-token');
  });

  it('rejects invalid repository URLs before calling the adapter', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.update('sandbox_1', { owner: '..', name: 'tribunal' }, 'a'.repeat(40), 'token'),
    ).rejects.toThrow('invalid clone input');
    expect(calls).toEqual([]);
  });

  it('validates runAgent output and delegates suspend and terminate calls', async () => {
    const { adapter, calls } = createFakeAdapter();
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    await expect(
      port.runAgent(
        'sandbox_1',
        'agent_run_1',
        {
          id: 'agent_1',
          userId: 1,
          slug: 'security-reviewer',
          description: 'Find security issues',
          body: 'Review.',
          model: 'sonnet',
          enabled: true,
        },
        'token',
        () => {},
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ agentSlug: 'security-reviewer' });
    await port.suspend('sandbox_1');
    await port.terminate('sandbox_1');

    expect(calls.map((call) => call.method)).toEqual(['runTrackedCommand', 'suspend', 'terminate']);
  });

  it('kills the tracked process for an active agent run', async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    let finishRun: (() => void) | undefined;
    const adapter: SandboxAdapter = {
      async create() {
        throw new Error('not used');
      },
      async runCommand() {
        throw new Error('not used');
      },
      async runTrackedCommand(sandboxId, command, arguments_, _environment, onProcessStart) {
        calls.push({ method: 'runTrackedCommand', input: { sandboxId, command, arguments_ } });
        await onProcessStart('456');
        await new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
      },
      async killProcess(sandboxId, processId) {
        calls.push({ method: 'killProcess', input: { sandboxId, processId } });
      },
      async suspend() {},
      async terminate() {},
    };
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    const run = port.runAgent(
      'sandbox_1',
      'agent_run_1',
      {
        id: 'agent_1',
        userId: 1,
        slug: 'security-reviewer',
        description: 'Find security issues',
        body: 'Review.',
        model: 'sonnet',
        enabled: true,
      },
      'token',
      () => {},
      new AbortController().signal,
    );
    await waitFor(() => calls.some((call) => call.method === 'runTrackedCommand'));

    await port.stop('sandbox_1', 'agent_run_1');
    finishRun?.();
    await run;

    expect(calls).toContainEqual({
      method: 'killProcess',
      input: { sandboxId: 'sandbox_1', processId: '456' },
    });
  });

  it('kills the tracked process when stop arrives before process start is reported', async () => {
    const calls: Array<{ method: string; input: unknown }> = [];
    let finishRun: (() => void) | undefined;
    let reportProcessStart: (() => Promise<void>) | undefined;
    const adapter: SandboxAdapter = {
      async create() {
        throw new Error('not used');
      },
      async runCommand() {
        throw new Error('not used');
      },
      async runTrackedCommand(sandboxId, command, arguments_, _environment, onProcessStart) {
        calls.push({ method: 'runTrackedCommand', input: { sandboxId, command, arguments_ } });
        reportProcessStart = () => onProcessStart('789');
        await new Promise<void>((resolve) => {
          finishRun = resolve;
        });
        return { exitCode: 0, stdout: JSON.stringify(result), stderr: '' };
      },
      async killProcess(sandboxId, processId) {
        calls.push({ method: 'killProcess', input: { sandboxId, processId } });
      },
      async suspend() {},
      async terminate() {},
    };
    const port = createSandboxPort(adapter, {
      image: 'tribunal-reviewer:latest',
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    const run = port.runAgent(
      'sandbox_1',
      'agent_run_1',
      {
        id: 'agent_1',
        userId: 1,
        slug: 'security-reviewer',
        description: 'Find security issues',
        body: 'Review.',
        model: 'sonnet',
        enabled: true,
      },
      'token',
      () => {},
      new AbortController().signal,
    );
    await waitFor(() => reportProcessStart !== undefined);

    await port.stop('sandbox_1', 'agent_run_1');
    await reportProcessStart?.();
    finishRun?.();
    await run;

    expect(calls).toContainEqual({
      method: 'killProcess',
      input: { sandboxId: 'sandbox_1', processId: '789' },
    });
  });
});

async function waitFor(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition was not met');
}
