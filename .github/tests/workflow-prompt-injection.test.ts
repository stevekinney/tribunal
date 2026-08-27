import { describe, expect, test } from 'vitest';
import {
  findUnsafeExpressionInterpolation,
  loadAllWorkflows,
  type Workflow,
} from '../scripts/workflow-policy';

/**
 * Treats every issue body, comment body, review body, PR title/body, and
 * attacker-named ref as untrusted prompt content. These checks assert the
 * structural invariant that defeats prompt injection into a `run:` shell
 * block — attacker text must be passed through `env:` and referenced as an
 * environment variable, never spliced directly into the script via
 * `${{ ... }}` — rather than simulating a live GitHub Actions run.
 *
 * Swept generically across every workflow under `.github/workflows/` (not
 * hardcoded to specific file names) so a newly added workflow is covered
 * automatically.
 */
describe('untrusted content cannot execute as shell syntax', () => {
  for (const { fileName, workflow } of loadAllWorkflows()) {
    test(`${fileName} never interpolates attacker-controlled text into a run: step`, () => {
      expect(findUnsafeExpressionInterpolation(workflow)).toEqual([]);
    });
  }
});

/**
 * Inline-fixture regressions for `findUnsafeExpressionInterpolation`,
 * independent of which real workflow files exist.
 */
describe('findUnsafeExpressionInterpolation: detects direct splicing, accepts env: indirection', () => {
  test('flags a run: step that splices an issue title directly into the script', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ github.event.issue.title }}"' }],
        },
      },
    };
    const violations = findUnsafeExpressionInterpolation(workflow);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/github\.event\.issue\.title/);
  });

  test('flags a run: step that splices a comment body directly into the script', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{github.event.comment.body}}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('does not flag the same text passed through env: and referenced as a shell variable', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [
            {
              env: { ISSUE_TITLE: '${{ github.event.issue.title }}' },
              run: 'echo "$ISSUE_TITLE"',
            },
          ],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toEqual([]);
  });

  test('does not flag run: steps with no untrusted fragments at all', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'bun run build' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toEqual([]);
  });

  test('flags every untrusted fragment interpolated in the same run: step', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [
            {
              run: 'echo "${{ github.event.pull_request.title }} ${{ github.event.pull_request.body }}"',
            },
          ],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(2);
  });
});

/**
 * TRI-28 B5: the previous implementation matched only the literal prefix
 * `${{ fragment` (one space) or `${{fragment` (no space), so anything else
 * GitHub evaluates identically — two spaces, a tab, a newline, or the
 * fragment appearing anywhere other than as the expression's first
 * characters (wrapped in `format(...)`, `toJson(...)`, string
 * concatenation, etc.) — bypassed it entirely.
 */
describe('findUnsafeExpressionInterpolation: whitespace- and wrapper-tolerant (TRI-28 B5)', () => {
  test('flags two spaces after `${{`', () => {
    const workflow: Workflow = {
      jobs: { build: { steps: [{ run: 'echo "${{  github.event.issue.title }}"' }] } },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags a tab after `${{`', () => {
    const workflow: Workflow = {
      jobs: { build: { steps: [{ run: 'echo "${{\tgithub.event.issue.title }}"' }] } },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags a newline inside the expression', () => {
    const workflow: Workflow = {
      jobs: { build: { steps: [{ run: 'echo "${{\n  github.event.issue.title }}"' }] } },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags the fragment wrapped in `format(...)`', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ format(\'issue: {0}\', github.event.issue.title) }}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags the fragment wrapped in `toJson(...)`', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: "echo '${{ toJson(github.event.issue.title) }}'" }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('does not flag a fragment name as a prefix of a longer, unrelated identifier', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ github.event.issue.title_hash }}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toEqual([]);
  });
});

/**
 * TRI-28 C2: `${{ github.event['issue']['title'] }}` is valid GitHub
 * expression syntax that evaluates identically to the dot form, but
 * whitespace normalization alone leaves the brackets intact, so no dot-form
 * fragment matched it. Property access is canonicalized to dot form before
 * fragment matching.
 */
describe('findUnsafeExpressionInterpolation: canonicalizes bracket-form property access (TRI-28 C2)', () => {
  test("flags single-quoted bracket-form access: `github.event['issue']['title']`", () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: "echo \"${{ github.event['issue']['title'] }}\"" }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags double-quoted bracket-form access: `github.event["issue"]["title"]`', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ github.event["issue"]["title"] }}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test("flags a mixed dot/bracket form: `github.event['issue'].title`", () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ github.event[\'issue\'].title }}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags bracket-form access to `github.event.comment.body`', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: "echo \"${{ github.event['comment']['body'] }}\"" }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });
});

/**
 * TRI-28 B6: fragments for `github.event.pull_request.head.ref` (a distinct
 * expression string from `github.head_ref` resolving to the same
 * attacker-controlled branch name), `github.event.discussion.title`/`.body`,
 * and `github.event.workflow_run.head_commit.message` (the pwn-request-via-
 * commit-message vector for `workflow_run` workflows).
 */
describe('findUnsafeExpressionInterpolation: new untrusted fragments (TRI-28 B6)', () => {
  test('flags `github.event.pull_request.head.ref`, distinctly from `github.head_ref`', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ github.event.pull_request.head.ref }}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags `github.event.discussion.title`', () => {
    const workflow: Workflow = {
      jobs: { build: { steps: [{ run: 'echo "${{ github.event.discussion.title }}"' }] } },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags `github.event.discussion.body`', () => {
    const workflow: Workflow = {
      jobs: { build: { steps: [{ run: 'echo "${{ github.event.discussion.body }}"' }] } },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('flags `github.event.workflow_run.head_commit.message`', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ github.event.workflow_run.head_commit.message }}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });
});

/**
 * TRI-28 C4: `github.event.workflow_run.head_branch` -- a fork contributor's
 * own branch name, which Git permits shell metacharacters in -- is the same
 * direct shell-injection class the list already covers via `head_ref`/
 * `head.ref`, but for the `workflow_run` trigger (an untrusted trigger as of
 * TRI-28 B1) specifically.
 */
describe('findUnsafeExpressionInterpolation: workflow_run head_branch (TRI-28 C4)', () => {
  test('flags `github.event.workflow_run.head_branch`', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ run: 'echo "${{ github.event.workflow_run.head_branch }}"' }],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });
});

/**
 * TRI-28 C5: `collectRunBlocks` previously read only `step.run`, so a
 * commenter-controlled `shell:` field -- which determines the command
 * interpreter the step's `run:` script executes under -- was invisible to
 * this audit. Moving attacker input from `run:` to `shell:` must not
 * bypass the gate.
 */
describe('findUnsafeExpressionInterpolation: custom shell: field (TRI-28 C5)', () => {
  test('flags a shell: field that splices a comment body directly', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [{ shell: '${{ github.event.comment.body }}', run: 'echo hello' }],
        },
      },
    };
    const violations = findUnsafeExpressionInterpolation(workflow);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toMatch(/github\.event\.comment\.body/);
  });

  test('flags an untrusted fragment in shell: even when run: itself is harmless', () => {
    const workflow: Workflow = {
      jobs: {
        build: {
          steps: [
            { shell: '${{ github.event.issue.title }}', run: 'echo "nothing dangerous here"' },
          ],
        },
      },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toHaveLength(1);
  });

  test('does not flag a fixed shell: field with no expression', () => {
    const workflow: Workflow = {
      jobs: { build: { steps: [{ shell: 'bash', run: 'echo hello' }] } },
    };
    expect(findUnsafeExpressionInterpolation(workflow)).toEqual([]);
  });
});
