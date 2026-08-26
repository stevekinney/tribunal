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
