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
  it('defaults to an in-progress Check Run with trimmed annotations in the output payload', async () => {
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
      external_id: undefined,
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

  it('creates a queued Check Run with an external id when requested', async () => {
    const create = vi.fn().mockResolvedValue({
      data: {
        id: 89,
        html_url: null,
      },
    });
    const context = createContext({ create });

    const result = await createCheckRun(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      name: 'Tribunal Review',
      headSha: 'abc123',
      status: 'queued',
      externalId: 'review_intent_123',
      detailsUrl: 'https://tribunal.dev/runs/review_intent_123',
    });

    expect(result).toEqual({ id: 89, htmlUrl: null });
    expect(create).toHaveBeenCalledWith({
      owner: 'lostgradient',
      repo: 'tribunal',
      name: 'Tribunal Review',
      head_sha: 'abc123',
      status: 'queued',
      external_id: 'review_intent_123',
      details_url: 'https://tribunal.dev/runs/review_intent_123',
    });
  });

  it('creates a Check Run with a Re-review action button', async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: 90, html_url: null } });
    const context = createContext({ create });

    await createCheckRun(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      name: 'Tribunal Review',
      headSha: 'abc123',
      status: 'queued',
      actions: [
        { label: 'Re-review', description: 'Run Tribunal review again', identifier: 're-review' },
      ],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          { label: 'Re-review', description: 'Run Tribunal review again', identifier: 're-review' },
        ],
      }),
    );
  });

  it('rejects more than 3 actions before calling GitHub', async () => {
    const create = vi.fn();
    const context = createContext({ create });
    const action = { label: 'Action', description: 'Description', identifier: 'action' };

    await expect(
      createCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        name: 'Tribunal Review',
        headSha: 'abc123',
        actions: [action, action, action, action],
      }),
    ).rejects.toThrow(ValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['label too long', { label: 'x'.repeat(21), description: 'ok', identifier: 'ok' }],
    ['description too long', { label: 'ok', description: 'x'.repeat(41), identifier: 'ok' }],
    ['identifier too long', { label: 'ok', description: 'ok', identifier: 'x'.repeat(21) }],
  ])('rejects an action with %s before calling GitHub', async (_label, action) => {
    const create = vi.fn();
    const context = createContext({ create });

    await expect(
      createCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        name: 'Tribunal Review',
        headSha: 'abc123',
        actions: [action],
      }),
    ).rejects.toThrow(ValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an invalid creation status before calling GitHub', async () => {
    const create = vi.fn();
    const context = createContext({ create });

    await expect(
      createCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        name: 'Tribunal Review',
        headSha: 'abc123',
        status: 'completed' as never,
      }),
    ).rejects.toThrow(ValidationError);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', { owner: ' ' }],
    ['repository', { repository: ' ' }],
    ['name', { name: '' }],
    ['headSha', { headSha: ' ' }],
    ['detailsUrl', { detailsUrl: '' }],
    ['externalId', { externalId: '' }],
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
  it('splits 60 annotations into two Check Run update calls spaced by at least a second', async () => {
    const update = vi.fn().mockResolvedValue({
      data: { id: 99, html_url: 'https://github.example/checks/99' },
    });
    const context = createContext({ update });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await updateCheckRun(
      context,
      {
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
      },
      { sleep },
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(1000);
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

  it('uses a real setTimeout-based sleep between annotation batches when no sleep is injected', async () => {
    vi.useFakeTimers();
    try {
      const update = vi.fn().mockResolvedValue({
        data: { id: 99, html_url: 'https://github.example/checks/99' },
      });
      const context = createContext({ update });

      const updatePromise = updateCheckRun(context, {
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

      // The first update call resolves synchronously (mocked), but the loop
      // awaits the real setTimeout-based `delay` before issuing the second
      // batch; advance fake timers to unblock it instead of waiting a real second.
      await vi.advanceTimersByTimeAsync(1000);
      await updatePromise;

      expect(update).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['0 findings', 0],
    ['exactly 50 findings', 50],
    ['51 findings', 51],
  ])('batches %s into the expected number of update calls', async (_label, count) => {
    const update = vi.fn().mockResolvedValue({
      data: { id: 99, html_url: null },
    });
    const context = createContext({ update });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await updateCheckRun(
      context,
      {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal',
          summary: 'Review finished',
          annotations: Array.from({ length: count }, (_, index) => createAnnotation(index)),
        },
      },
      { sleep },
    );

    const expectedCalls = count === 0 ? 1 : Math.ceil(count / 50);
    expect(update).toHaveBeenCalledTimes(expectedCalls);
    const totalAnnotations = update.mock.calls.reduce(
      (total, call) => total + call[0].output.annotations.length,
      0,
    );
    expect(totalAnnotations).toBe(count);
  });

  it('sets started_at when transitioning to in_progress', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 99, html_url: null } });
    const context = createContext({ update });

    await updateCheckRun(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      checkRunId: 99,
      status: 'in_progress',
      startedAt: '2026-07-06T12:00:00.000Z',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ started_at: '2026-07-06T12:00:00.000Z' }),
    );
  });

  it('includes the Re-review action only on the first annotation batch', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 99, html_url: null } });
    const context = createContext({ update });
    const sleep = vi.fn().mockResolvedValue(undefined);

    await updateCheckRun(
      context,
      {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        status: 'completed',
        conclusion: 'success',
        actions: [
          { label: 'Re-review', description: 'Run Tribunal review again', identifier: 're-review' },
        ],
        output: {
          title: 'Tribunal',
          summary: 'Review finished',
          annotations: Array.from({ length: 60 }, (_, index) => createAnnotation(index)),
        },
      },
      { sleep },
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0].actions).toEqual([
      { label: 'Re-review', description: 'Run Tribunal review again', identifier: 're-review' },
    ]);
    expect(update.mock.calls[1][0].actions).toBeUndefined();
  });

  it('rejects an invalid update action before calling GitHub', async () => {
    const update = vi.fn();
    const context = createContext({ update });

    await expect(
      updateCheckRun(context, {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        status: 'completed',
        conclusion: 'success',
        actions: [{ label: 'x'.repeat(21), description: 'ok', identifier: 'ok' }],
      }),
    ).rejects.toThrow(ValidationError);
    expect(update).not.toHaveBeenCalled();
  });

  it('truncates output.summary at a UTF-8 byte boundary without splitting a surrogate pair', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 99, html_url: null } });
    const context = createContext({ update });
    // Each emoji is a 4-byte UTF-8 surrogate pair; comfortably exceeds the 60,000 byte cap.
    const hugeSummary = '🔥'.repeat(20_000);

    await updateCheckRun(context, {
      installationId: 1,
      owner: 'lostgradient',
      repository: 'tribunal',
      checkRunId: 99,
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'Tribunal',
        summary: hugeSummary,
      },
    });

    const sentSummary = update.mock.calls[0][0].output.summary as string;
    const encoder = new TextEncoder();
    expect(encoder.encode(sentSummary).length).toBeLessThanOrEqual(60_000);
    expect(sentSummary).toContain('truncated');
    // No lone surrogate: re-encoding/decoding round-trips without replacement characters.
    expect(sentSummary).not.toContain('�');
  });

  it('does not split a surrogate pair straddling the exact 60,000-byte cutoff', async () => {
    const update = vi.fn().mockResolvedValue({ data: { id: 99, html_url: null } });
    const context = createContext({ update });
    // 59,999 single-byte ASCII characters, then a 4-byte emoji (surrogate pair
    // in UTF-16) whose bytes span 59,999-60,002 — the emoji straddles the
    // 60,000-byte cutoff exactly, so a naive byte-slice would split it and
    // produce an unpaired surrogate / invalid UTF-8.
    const straddling = `${'a'.repeat(59_999)}\u{1F525}`;
    const encoder = new TextEncoder();
    expect(encoder.encode(straddling).length).toBe(60_003);

    await updateCheckRun(
      context,
      {
        installationId: 1,
        owner: 'lostgradient',
        repository: 'tribunal',
        checkRunId: 99,
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Tribunal',
          summary: straddling,
        },
      },
      { sleep: vi.fn().mockResolvedValue(undefined) },
    );

    const sentSummary = update.mock.calls[0][0].output.summary as string;
    expect(encoder.encode(sentSummary).length).toBeLessThanOrEqual(60_000);
    // The whole emoji must be dropped, not half of it: either the truncated
    // body ends in the untouched ASCII run (no trailing surrogate at all), or
    // it ends with a properly paired high+low surrogate.
    const body = sentSummary.slice(0, sentSummary.indexOf('\n\n_...truncated'));
    const lastCharCode = body.charCodeAt(body.length - 1);
    const isHighSurrogate = lastCharCode >= 0xd800 && lastCharCode <= 0xdbff;
    expect(isHighSurrogate).toBe(false);
    // Round-tripping through the encoder must not introduce replacement
    // characters, which is what a split surrogate pair produces.
    expect(sentSummary).not.toContain('�');
    expect(new TextDecoder('utf-8', { fatal: true }).decode(encoder.encode(sentSummary))).toBe(
      sentSummary,
    );
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
