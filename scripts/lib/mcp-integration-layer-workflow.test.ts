import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

type IssueDescriptor = {
  id: string;
  title: string;
  body: string;
  branch: string;
  mode: 'implement' | 'decide';
  humanCheckpoint: boolean;
  model: 'opus' | 'sonnet' | 'haiku';
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

type WorkflowResult = {
  ready: Array<{ issue: string }>;
  rework: Array<{ issue: string }>;
  handBack: Array<{ issue: string }>;
  invalid: string[];
};

const workflowPath = resolve(
  import.meta.dirname,
  '../../.claude/workflows/mcp-integration-layer.mjs',
);
const workflowSource = readFileSync(workflowPath, 'utf8').replace(
  'export const meta',
  'const meta',
);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...arguments_: string[]
) => (...values: unknown[]) => Promise<WorkflowResult>;

function descriptor(overrides: Partial<IssueDescriptor> = {}): IssueDescriptor {
  return {
    id: 'TRI-TEST',
    title: 'Test workflow behavior',
    body: 'Acceptance criterion: prove the workflow behavior.',
    branch: 'tri-test',
    mode: 'implement',
    humanCheckpoint: false,
    model: 'sonnet',
    effort: 'medium',
    ...overrides,
  };
}

async function executeWorkflow(
  issues: IssueDescriptor[],
  agent: (prompt: string, options: { phase: string }) => unknown,
): Promise<WorkflowResult> {
  const pipeline = async (
    inputs: IssueDescriptor[],
    execute: (issue: IssueDescriptor) => unknown,
    verify: (report: unknown, issue: IssueDescriptor) => unknown,
  ) => Promise.all(inputs.map(async (issue) => verify(await execute(issue), issue)));
  const run = new AsyncFunction('args', 'log', 'pipeline', 'agent', workflowSource);
  return run({ issues }, vi.fn(), pipeline, agent);
}

describe('MCP integration layer workflow', () => {
  test('routes a satisfied human decision checkpoint into handBack', async () => {
    let verifyPrompt = '';
    const agent = vi.fn((prompt: string, options: { phase: string }) => {
      if (options.phase === 'Execute') {
        return {
          issue: 'TRI-TEST',
          pushed: true,
          branch: 'tri-test',
          filesChanged: ['decision.md'],
          verification: [],
          unmetCriteria: [],
          notes: '',
        };
      }
      verifyPrompt = prompt;
      return {
        issue: 'TRI-TEST',
        criteriaVerified: [{ criterion: 'decision drafted', met: true, evidence: 'exit 0' }],
        confirmedMet: true,
        problems: [],
        recommendation: 'open-pull-request',
      };
    });

    const result = await executeWorkflow(
      [descriptor({ mode: 'decide', humanCheckpoint: true })],
      agent,
    );

    expect(result.ready).toEqual([]);
    expect(result.rework).toEqual([]);
    expect(result.handBack).toEqual([expect.objectContaining({ issue: 'TRI-TEST' })]);
    expect(verifyPrompt).toContain('You MUST set `recommendation` to `hand-back-to-human`');
    expect(verifyPrompt).toContain('humanCheckpoint is `true`');
  });

  test('routes a satisfied implementation checkpoint with notes into handBack', async () => {
    let executePrompt = '';
    const agent = vi.fn((prompt: string, options: { phase: string }) => {
      if (options.phase === 'Execute') {
        executePrompt = prompt;
        return {
          issue: 'TRI-TEST',
          pushed: true,
          branch: 'tri-test',
          filesChanged: [],
          verification: [],
          unmetCriteria: [],
          notes: '',
        };
      }
      return {
        issue: 'TRI-TEST',
        criteriaVerified: [{ criterion: 'release prepared', met: true, evidence: 'exit 0' }],
        confirmedMet: true,
        problems: ['A human must publish the prepared release.'],
        recommendation: 'open-pull-request',
      };
    });

    const result = await executeWorkflow(
      [descriptor({ mode: 'implement', humanCheckpoint: true })],
      agent,
    );

    expect(result.ready).toEqual([]);
    expect(result.rework).toEqual([]);
    expect(result.handBack).toEqual([expect.objectContaining({ issue: 'TRI-TEST' })]);
    expect(executePrompt).toContain('Stop before any action that requires a person');
    expect(executePrompt).toContain('Never perform or claim the human-only action');
  });

  test('preserves a rework verdict for a human checkpoint with verification problems', async () => {
    const agent = vi.fn((_prompt: string, options: { phase: string }) => {
      if (options.phase === 'Execute') {
        return {
          issue: 'TRI-TEST',
          pushed: true,
          branch: 'tri-test',
          filesChanged: [],
          verification: [],
          unmetCriteria: [],
          notes: '',
        };
      }
      return {
        issue: 'TRI-TEST',
        criteriaVerified: [{ criterion: 'release prepared', met: false, evidence: 'exit 1' }],
        confirmedMet: false,
        problems: ['Verification failed.'],
        recommendation: 'needs-rework',
      };
    });

    const result = await executeWorkflow(
      [descriptor({ mode: 'implement', humanCheckpoint: true })],
      agent,
    );

    expect(result.ready).toEqual([]);
    expect(result.handBack).toEqual([]);
    expect(result.rework).toEqual([expect.objectContaining({ issue: 'TRI-TEST' })]);
  });

  test('permits Svelte source while barring JavaScript-family source alternatives', async () => {
    let executePrompt = '';
    const agent = vi.fn((prompt: string, options: { phase: string }) => {
      if (options.phase === 'Execute') {
        executePrompt = prompt;
        return {
          issue: 'TRI-TEST',
          pushed: true,
          branch: 'tri-test',
          filesChanged: [],
          verification: [],
          unmetCriteria: [],
          notes: '',
        };
      }
      return {
        issue: 'TRI-TEST',
        criteriaVerified: [],
        confirmedMet: true,
        problems: [],
        recommendation: 'open-pull-request',
      };
    });

    await executeWorkflow([descriptor()], agent);

    expect(executePrompt).toContain('Svelte components use `.svelte`');
    for (const extension of ['`.js`', '`.mjs`', '`.cjs`', '`.jsx`']) {
      expect(executePrompt).toContain(extension);
    }
    expect(executePrompt).toContain('Svelte MCP autofixer');
    expect(executePrompt).not.toContain('Source code** is TypeScript only (`.ts`/`.tsx`)');
  });

  test('rejects HEAD as invalid before dispatching an agent', async () => {
    const agent = vi.fn();

    const result = await executeWorkflow([descriptor({ branch: 'HEAD' })], agent);

    expect(result.invalid).toEqual([expect.stringContaining('HEAD')]);
    expect(agent).not.toHaveBeenCalled();
  });
});
