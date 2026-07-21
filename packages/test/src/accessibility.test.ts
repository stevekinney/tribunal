import { afterEach, describe, expect, it, vi } from 'vitest';

// axe-core needs a real DOM (window/document) to run against, but this
// package's Vitest environment is `node`. We mock axe-core itself (a
// third-party dependency, not the module under test) so the real logic in
// accessibility.ts -- option merging, exclude handling, violation logging,
// and the pass/fail assertion -- executes for real.
const runMock = vi.fn();

vi.mock('axe-core', () => ({
  default: { run: runMock },
}));

describe('expectNoA11yViolations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runMock.mockReset();
  });

  it('runs axe against the global document with default WCAG rules when no options are given', async () => {
    runMock.mockResolvedValue({ violations: [] });
    const fakeDocument = { nodeType: 9 };
    vi.stubGlobal('document', fakeDocument);

    const { expectNoA11yViolations } = await import('./accessibility');
    await expectNoA11yViolations();

    expect(runMock).toHaveBeenCalledTimes(1);
    const [context, runOptions] = runMock.mock.calls[0] as [
      unknown,
      { runOnly: unknown; rules: Record<string, { enabled: boolean }> },
    ];
    expect(context).toBe(fakeDocument);
    expect(runOptions.runOnly).toEqual({
      type: 'tag',
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
    });
    expect(runOptions.rules['landmark-one-main']).toEqual({ enabled: false });

    vi.unstubAllGlobals();
  });

  it('scopes to an explicit context without excludes', async () => {
    runMock.mockResolvedValue({ violations: [] });

    const { expectNoA11yViolations } = await import('./accessibility');
    await expectNoA11yViolations({ context: 'main' });

    const [context] = runMock.mock.calls[0] as [unknown];
    expect(context).toBe('main');
  });

  it('wraps the context in an include/exclude object when exclude is provided', async () => {
    runMock.mockResolvedValue({ violations: [] });

    const { expectNoA11yViolations } = await import('./accessibility');
    await expectNoA11yViolations({ context: 'main', exclude: ['.skip-this'] });

    const [context] = runMock.mock.calls[0] as [{ include: unknown[]; exclude: string[] }];
    expect(context).toEqual({ include: ['main'], exclude: ['.skip-this'] });
  });

  it('merges custom rule overrides on top of the defaults', async () => {
    runMock.mockResolvedValue({ violations: [] });

    const { expectNoA11yViolations } = await import('./accessibility');
    await expectNoA11yViolations({ context: 'main', rules: { 'custom-rule': { enabled: true } } });

    const [, runOptions] = runMock.mock.calls[0] as [
      unknown,
      { rules: Record<string, { enabled: boolean }> },
    ];
    expect(runOptions.rules['custom-rule']).toEqual({ enabled: true });
    expect(runOptions.rules['label']).toEqual({ enabled: false });
  });

  it('logs violation details and throws when axe finds violations', async () => {
    runMock.mockResolvedValue({
      violations: [
        {
          impact: 'serious',
          id: 'color-contrast',
          description: 'Elements must meet contrast ratio',
          nodes: [{ html: '<button>Click</button>' }],
        },
      ],
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { expectNoA11yViolations } = await import('./accessibility');

    await expect(expectNoA11yViolations({ context: 'main' })).rejects.toThrow();
    expect(logSpy).toHaveBeenCalledWith('\nA11y violations:');
    expect(logSpy.mock.calls.flat().some((line) => String(line).includes('color-contrast'))).toBe(
      true,
    );
  });
});
