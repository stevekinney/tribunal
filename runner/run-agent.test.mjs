import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  emitEvent,
  resolveEffortUsed,
  resolveModelUsed,
  runAgentProcess,
  runClaudeReview,
} from './run-agent.mjs';

const baseEnvironment = {
  NODE_ENV: 'test',
  TRIBUNAL_RUN_TOKEN: 'run-token',
  TRIBUNAL_AGENT_RUN_ID: 'agent_run_1',
  TRIBUNAL_AGENT_MODEL: 'sonnet',
  TRIBUNAL_AGENT_EFFORT: 'xhigh',
  TRIBUNAL_DIFF_CONTEXT: JSON.stringify({
    headSha: 'head',
    baseSha: 'base',
    changedFiles: [],
    pr: { number: 1, title: 'Pull request', body: '', labels: [], author: 'steve' },
  }),
};

function createWritable() {
  let value = '';
  return {
    write(chunk) {
      value += chunk;
    },
    toString() {
      return value;
    },
    records() {
      return value
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

async function* streamMessages(messages) {
  for (const message of messages) yield message;
}

describe('run-agent runner', () => {
  it('only short-circuits TRIBUNAL_AGENT_RESULT_FILE in test mode', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tribunal-runner-'));
    const resultFile = join(directory, 'result.jsonl');
    await writeFile(resultFile, '{"type":"result","result":{"agentSlug":"fixture"}}\n');
    const stdout = createWritable();

    await runAgentProcess({
      argv: ['node', 'run-agent.mjs', 'security-reviewer'],
      environment: { ...baseEnvironment, TRIBUNAL_AGENT_RESULT_FILE: resultFile },
      stdout,
      stderr: createWritable(),
      exit: vi.fn(),
      signalSource: new EventEmitter(),
      queryFunction: vi.fn(),
    });

    expect(stdout.toString()).toBe('{"type":"result","result":{"agentSlug":"fixture"}}\n');

    const productionQuery = vi.fn(() =>
      streamMessages([
        {
          type: 'result',
          structured_output: { findings: [] },
          modelUsage: { model_id: 'claude-sonnet-4-6-20251101', effort: 'high' },
          usage: {},
          total_cost_usd: 0,
        },
      ]),
    );
    const productionStdout = createWritable();
    await runAgentProcess({
      argv: ['node', 'run-agent.mjs', 'security-reviewer'],
      environment: { ...baseEnvironment, NODE_ENV: 'production', TRIBUNAL_AGENT_RESULT_FILE: resultFile },
      stdout: productionStdout,
      stderr: createWritable(),
      exit: vi.fn(),
      signalSource: new EventEmitter(),
      queryFunction: productionQuery,
    });

    expect(productionQuery).toHaveBeenCalledTimes(1);
    expect(productionStdout.records().at(-1)).toMatchObject({
      type: 'result',
      result: { modelUsed: 'claude-sonnet-4-6-20251101', effortUsed: 'high' },
    });
  });

  it('emits wrapped event records with deterministic sequence numbers', () => {
    const stdout = createWritable();
    const context = { agentRunId: 'agent_run_1', sequence: 0, stdout };

    emitEvent(context, 'tool_pre', { allowed: true }, 'Read');
    emitEvent(context, 'message', { uuid: 'message_1' });

    expect(stdout.records()).toMatchObject([
      {
        type: 'event',
        event: { agentRunId: 'agent_run_1', seq: 1, kind: 'tool_pre', tool: 'Read' },
      },
      { type: 'event', event: { agentRunId: 'agent_run_1', seq: 2, kind: 'message' } },
    ]);
  });

  it('uses SDK-resolved model and effort values in successful results', async () => {
    const result = await runClaudeReview({
      agentSlug: 'security-reviewer',
      repositoryPath: '/workspace/repository',
      model: 'sonnet',
      effort: 'xhigh',
      diffContext: {
        headSha: 'head',
        baseSha: 'base',
        changedFiles: [],
        pr: { number: 1, title: '', body: '', labels: [], author: '' },
      },
      queryFunction: () =>
        streamMessages([
          {
            type: 'result',
            structured_output: { findings: [] },
            modelUsage: { model_id: 'claude-sonnet-4-6-20251101', effort: 'high' },
            usage: { input_tokens: 2, output_tokens: 3 },
            total_cost_usd: 0.04,
          },
        ]),
      elapsedMilliseconds: () => 12,
    });

    expect(result).toMatchObject({
      modelUsed: 'claude-sonnet-4-6-20251101',
      effortUsed: 'high',
      usage: { inputTokens: 2, outputTokens: 3 },
      costEstimateUsd: 0.04,
      durationMs: 12,
    });
    expect(resolveModelUsed('sonnet', {})).toBe('sonnet');
    expect(resolveEffortUsed('xhigh', { modelUsage: { effort: 'turbo' } })).toBe('xhigh');
  });

  it('writes partial cost when a SIGTERM arrives before completion', async () => {
    const signalSource = new EventEmitter();
    const stdout = createWritable();
    const exit = vi.fn();
    let releaseQuery;
    async function* signalAfterCostCapture() {
      yield {
        type: 'result',
        structured_output: { findings: [] },
        modelUsage: { model_id: 'claude-sonnet-4-6-20251101', effort: 'high' },
        usage: { input_tokens: 5 },
        total_cost_usd: 0.09,
      };
      signalSource.emit('SIGTERM');
      yield await new Promise((resolve) => {
        releaseQuery = () => resolve({ type: 'system', subtype: 'done' });
      });
    }
    const run = runAgentProcess({
      argv: ['node', 'run-agent.mjs', 'security-reviewer'],
      environment: baseEnvironment,
      stdout,
      stderr: createWritable(),
      exit,
      signalSource,
      performanceNow: vi.fn().mockReturnValueOnce(100).mockReturnValue(125),
      queryFunction: signalAfterCostCapture,
    });

    await waitFor(() => exit.mock.calls.length > 0);
    releaseQuery();
    await run;

    expect(exit).toHaveBeenCalledWith(143);
    expect(stdout.records().find((record) => record.type === 'result')).toMatchObject({
      type: 'result',
      result: {
        modelUsed: 'claude-sonnet-4-6-20251101',
        effortUsed: 'high',
        costEstimateUsd: 0.09,
        error: 'Agent review stopped before completion.',
      },
    });
  });
});

async function waitFor(assertion) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition was not met');
}
