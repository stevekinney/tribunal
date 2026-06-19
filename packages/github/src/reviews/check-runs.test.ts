import { describe, expect, it, vi } from 'vitest';
import type { Octokit } from 'octokit';
import type { GithubServiceContext } from '../context.js';
import { ValidationError } from '../error-taxonomy.js';
import { createCheckRun, updateCheckRun } from './check-runs.js';

function createContext(input: {
  create?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  octokit?: Octokit | null;
}): GithubServiceContext {
  return {
    db: {} as GithubServiceContext['db'],
    cache: {} as GithubServiceContext['cache'],
    getInstallationOctokit: vi.fn().mockResolvedValue(
      input.octokit === undefined
        ? ({
            rest: {
              checks: {
                create: input.create,
                update: input.update,
              },
            },
          } as unknown as Octokit)
        : input.octokit,
    ),
  };
}

function createAnnotation(index: number) {
  return {
    path: `src/file-${index}.ts`,
    startLine: index + 1,
    endLine: index + 1,
    annotationLevel: 'warning' as const,
    message: `Finding ${index}`,
  };
}

describe('createCheckRun', () => {
  it('creates an in-progress Check Run with trimmed annotations in the output payload', async () => {
    const create = vi.fn().mockResolvedValue({
      data: {
        id: 88,
        html_url: null,
      },
    });
    const context = createContext({ create });

    const result = await createCheckRun(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      name: 'Tribunal review',
      headSha: 'abc123',
      detailsUrl: 'https://example.test/details',
      output: {
        title: 'Tribunal',
        summary: 'Review started',
        text: 'Running checks',
        annotations: [
          {
            path: 'src/example.ts',
            startLine: 4,
            endLine: 4,
            annotationLevel: 'notice',
            message: '  Heads up.  ',
            title: 'Observation',
            rawDetails: 'Additional context',
          },
        ],
      },
    });

    expect(result).toEqual({ id: 88, htmlUrl: null });
    expect(create).toHaveBeenCalledWith({
      owner: 'lostgradient',
      repo: 'tribunal',
      name: 'Tribunal review',
      head_sha: 'abc123',
      status: 'in_progress',
      details_url: 'https://example.test/details',
      output: {
        title: 'Tribunal',
        summary: 'Review started',
        text: 'Running checks',
        annotations: [
          {
            path: 'src/example.ts',
            start_line: 4,
            end_line: 4,
            annotation_level: 'notice',
            message: 'Heads up.',
            title: 'Observation',
            raw_details: 'Additional context',
          },
        ],
      },
    });
  });

  it.each([
    ['owner', { owner: ' ' }],
    ['repository', { repository: ' ' }],
    ['name', { name: '' }],
    ['headSha', { headSha: ' ' }],
    ['detailsUrl', { detailsUrl: '' }],
    ['output.title', { output: { title: '', summary: 'summary' } }],
    ['output.summary', { output: { title: 'title', summary: ' ' } }],
    ['output.text', { output: { title: 'title', summary: 'summary', text: '' } }],
  ])('rejects invalid %s before calling GitHub', async (_label, override) => {
    const create = vi.fn();
    const context = createContext({ create });

    await expect(
      createCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        name: 'Tribunal review',
        headSha: 'abc123',
        ...override,
      }),
    ).rejects.toThrow(ValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects unavailable installations before calling GitHub', async () => {
    const create = vi.fn();
    const context = createContext({ create, octokit: null });

    await expect(
      createCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        name: 'Tribunal review',
        headSha: 'abc123',
      }),
    ).rejects.toThrow(ValidationError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('updateCheckRun', () => {
  it('splits 60 annotations into two Check Run update calls', async () => {
    const update = vi.fn().mockResolvedValue({
      data: {
        id: 99,
        html_url: 'https://github.example/checks/99',
      },
    });
    const context = createContext({ update });

    await updateCheckRun(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      checkRunId: 99,
      status: 'completed',
      conclusion: 'failure',
      output: {
        title: 'Tribunal',
        summary: 'Review finished',
        annotations: Array.from({ length: 60 }, (_, index) => createAnnotation(index)),
      },
    });

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0].output.annotations).toHaveLength(50);
    expect(update.mock.calls[1][0].output.annotations).toHaveLength(10);
    expect(update.mock.calls[0][0]).toMatchObject({
      owner: 'lostgradient',
      repo: 'tribunal',
      check_run_id: 99,
      status: 'completed',
      conclusion: 'failure',
    });
  });

  it('rejects invalid annotation ranges before calling GitHub', async () => {
    const update = vi.fn();
    const context = createContext({ update });

    await expect(
      updateCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        status: 'completed',
        conclusion: 'failure',
        output: {
          title: 'Tribunal',
          summary: 'Review finished',
          annotations: [
            {
              path: 'src/example.ts',
              startLine: 10,
              endLine: 9,
              annotationLevel: 'warning',
              message: 'Range points backwards.',
            },
          ],
        },
      }),
    ).rejects.toThrow(ValidationError);
    expect(update).not.toHaveBeenCalled();
  });

  it('updates a Check Run without output when only status changes', async () => {
    const update = vi.fn().mockResolvedValue({
      data: {
        id: 99,
        html_url: null,
      },
    });
    const context = createContext({ update });

    const result = await updateCheckRun(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      checkRunId: 99,
      status: 'queued',
    });

    expect(result).toEqual({ id: 99, htmlUrl: null });
    expect(update).toHaveBeenCalledWith({
      owner: 'lostgradient',
      repo: 'tribunal',
      check_run_id: 99,
      status: 'queued',
      conclusion: undefined,
      completed_at: undefined,
    });
  });

  it.each([
    ['checkRunId', { checkRunId: 0 }],
    ['status', { status: 'waiting' }],
    ['conclusion', { conclusion: 'unknown' }],
    [
      'annotation.path',
      {
        output: {
          title: 'title',
          summary: 'summary',
          annotations: [{ ...createAnnotation(1), path: '' }],
        },
      },
    ],
    [
      'annotation.startLine',
      {
        output: {
          title: 'title',
          summary: 'summary',
          annotations: [{ ...createAnnotation(1), startLine: 0 }],
        },
      },
    ],
    [
      'annotation.annotationLevel',
      {
        output: {
          title: 'title',
          summary: 'summary',
          annotations: [{ ...createAnnotation(1), annotationLevel: 'debug' }],
        },
      },
    ],
    [
      'annotation.message',
      {
        output: {
          title: 'title',
          summary: 'summary',
          annotations: [{ ...createAnnotation(1), message: ' ' }],
        },
      },
    ],
    [
      'annotation.title',
      {
        output: {
          title: 'title',
          summary: 'summary',
          annotations: [{ ...createAnnotation(1), title: '' }],
        },
      },
    ],
    [
      'annotation.rawDetails',
      {
        output: {
          title: 'title',
          summary: 'summary',
          annotations: [{ ...createAnnotation(1), rawDetails: ' ' }],
        },
      },
    ],
  ])('rejects invalid %s before calling GitHub', async (_label, override) => {
    const update = vi.fn();
    const context = createContext({ update });

    await expect(
      updateCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        status: 'completed',
        ...override,
      }),
    ).rejects.toThrow(ValidationError);
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a conclusion when status is not completed', async () => {
    const update = vi.fn();
    const context = createContext({ update });

    await expect(
      updateCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        status: 'in_progress',
        conclusion: 'failure',
      }),
    ).rejects.toThrow('A Check Run conclusion can only be set when status is completed.');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a conclusion without an explicit completed status before calling GitHub', async () => {
    const update = vi.fn();
    const context = createContext({ update });

    await expect(
      updateCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        conclusion: 'success',
      }),
    ).rejects.toThrow('A Check Run conclusion requires status completed.');
    expect(update).not.toHaveBeenCalled();
  });
});
