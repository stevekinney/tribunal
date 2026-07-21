/**
 * Tests for action-items pure functions:
 * - parseActionItemsBlock / renderActionItemsBlock (round-trip)
 * - reconcileActionItems (human-checked state, auto-completion, orphan preservation)
 * - deterministicSummary
 * - sanitizeActionItemCandidate
 * - extractSourceType
 * - computeActionItemStatus
 */

import { describe, expect, it } from 'vitest';

import {
  parseActionItemsBlock,
  reconcileActionItems,
  renderActionItemsBlock,
  updatePRDescription,
  type ActionItem,
  type ConversationState,
  type DerivedActionItem,
  type ParsedActionItem,
} from './action-items.js';
import { computeActionItemStatus } from './compute-action-item-status.js';
import { extractSourceType } from './extract-source-type.js';
import { sanitizeActionItemCandidate } from './sanitization.js';
import { deterministicSummary } from './summarize.js';
import { safeCheckKeySegment } from './analyze-pull-request.js';

// ============================================================================
// Helpers
// ============================================================================

function emptyState(): ConversationState {
  return {
    resolvedThreadIds: new Set(),
    allChecksPassing: false,
    passingCheckNames: new Set(),
  };
}

// ============================================================================
// parseActionItemsBlock / renderActionItemsBlock — round-trip
// ============================================================================

describe('parse → render round-trip', () => {
  it('renders items with Tribunal namespace markers (not DEPICT)', () => {
    const items: ActionItem[] = [
      { id: 'review-comment:RT_abc:C_123', description: 'Add null check', completed: false },
    ];
    const rendered = renderActionItemsBlock(items);

    expect(rendered).toContain('<!--TRIBUNAL-ACTION-ITEMS-START-->');
    expect(rendered).toContain('<!--TRIBUNAL-ACTION-ITEMS-END-->');
    expect(rendered).not.toContain('DEPICT');
    expect(rendered).toContain('<!-- tribunal:ai:review-comment:RT_abc:C_123 -->');
  });

  it('survives a full round-trip: render then parse yields the same items', () => {
    const items: ActionItem[] = [
      {
        id: 'review-comment:RT_abc:C_123',
        description: 'Add null check',
        completed: false,
        sourceUrl: 'https://github.com/example/pr/1#comment-1',
      },
      {
        id: 'ci-check-lint',
        description: 'Fix CI: lint check',
        completed: true,
      },
    ];

    const rendered = renderActionItemsBlock(items);
    const parsed = parseActionItemsBlock(rendered);

    expect(parsed).not.toBeNull();
    expect(parsed!.items).toHaveLength(2);

    const [first, second] = parsed!.items;

    expect(first.id).toBe('review-comment:RT_abc:C_123');
    expect(first.description).toBe('Add null check');
    expect(first.completed).toBe(false);
    expect(first.sourceUrl).toBe('https://github.com/example/pr/1#comment-1');

    expect(second.id).toBe('ci-check-lint');
    expect(second.description).toBe('Fix CI: lint check');
    expect(second.completed).toBe(true);
  });

  it('preserves stable IDs across the round-trip', () => {
    const ids = ['review-thread-RT_abc123', 'ci-check-typecheck', 'review-comment:RT_x:C_y'];
    const items: ActionItem[] = ids.map((id) => ({
      id,
      description: `Item for ${id}`,
      completed: false,
    }));

    const rendered = renderActionItemsBlock(items);
    const parsed = parseActionItemsBlock(rendered);

    expect(parsed!.items.map((i) => i.id)).toEqual(ids);
  });

  it('applies strikethrough to completed items in the rendered output', () => {
    const items: ActionItem[] = [
      { id: 'ci-check-lint', description: 'Fix linting', completed: true },
    ];
    const rendered = renderActionItemsBlock(items);

    expect(rendered).toContain('~~Fix linting~~');
    expect(rendered).toContain('[x]');
  });

  it('renders empty-block placeholder when there are no valid items', () => {
    const rendered = renderActionItemsBlock([]);

    expect(rendered).toContain('_No action items yet._');
    expect(rendered).toContain('<!--TRIBUNAL-ACTION-ITEMS-START-->');
    expect(rendered).toContain('<!--TRIBUNAL-ACTION-ITEMS-END-->');
  });

  it('returns null when the body has no block markers', () => {
    const result = parseActionItemsBlock('No action items here.');
    expect(result).toBeNull();
  });

  it('returns null when the start marker is present but the end marker is missing', () => {
    const result = parseActionItemsBlock('<!--TRIBUNAL-ACTION-ITEMS-START-->\n- [ ] Do a thing');
    expect(result).toBeNull();
  });

  it('skips a line that matches the stable-id comment but is not a checklist item', () => {
    const body = [
      '<!--TRIBUNAL-ACTION-ITEMS-START-->',
      '## Action Items',
      'Not a checklist line <!-- tribunal:ai:some-id -->',
      '<!--TRIBUNAL-ACTION-ITEMS-END-->',
    ].join('\n');

    const parsed = parseActionItemsBlock(body);

    expect(parsed!.items).toHaveLength(0);
  });

  it('skips a checklist line with no tribunal:ai: stable-id comment', () => {
    const body = [
      '<!--TRIBUNAL-ACTION-ITEMS-START-->',
      '## Action Items',
      '- [ ] A human-added checklist item with no marker',
      '<!--TRIBUNAL-ACTION-ITEMS-END-->',
    ].join('\n');

    const parsed = parseActionItemsBlock(body);

    expect(parsed!.items).toHaveLength(0);
  });

  it('records startIndex and endIndex that span the block', () => {
    const prefix = 'Some description text.\n\n';
    const items: ActionItem[] = [{ id: 'x', description: 'Do something', completed: false }];
    const block = renderActionItemsBlock(items);
    const body = prefix + block;

    const parsed = parseActionItemsBlock(body);

    expect(parsed).not.toBeNull();
    expect(parsed!.startIndex).toBe(prefix.length);
    expect(parsed!.endIndex).toBe(body.length);
  });
});

// ============================================================================
// reconcileActionItems — human-checked state preservation
// ============================================================================

describe('reconcileActionItems — human-checked state', () => {
  it('preserves an existing completed=true state even when derived says false', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-comment:RT_abc:C_1',
        description: 'Add null check',
        completed: true,
        rawLine: '- [x] ~~Add null check~~ <!-- tribunal:ai:review-comment:RT_abc:C_1 -->',
      },
    ];
    const derived: DerivedActionItem[] = [
      { id: 'review-comment:RT_abc:C_1', description: 'Add null check', completed: false },
    ];

    const result = reconcileActionItems(existing, derived, emptyState());

    expect(result).toHaveLength(1);
    expect(result[0].completed).toBe(true);
  });

  it('auto-completes a review-thread item when its thread is resolved', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-thread-RT_abc123',
        description: 'Address feedback',
        completed: false,
        rawLine: '- [ ] Address feedback <!-- tribunal:ai:review-thread-RT_abc123 -->',
      },
    ];
    const derived: DerivedActionItem[] = [
      { id: 'review-thread-RT_abc123', description: 'Address feedback', completed: false },
    ];
    const state: ConversationState = {
      resolvedThreadIds: new Set(['RT_abc123']),
      allChecksPassing: false,
      passingCheckNames: new Set(),
    };

    const result = reconcileActionItems(existing, derived, state);

    expect(result[0].completed).toBe(true);
  });

  it('auto-completes a review-comment item when its thread id is resolved', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-comment:RT_thread1:C_comment1',
        description: 'Fix the thing',
        completed: false,
        rawLine: '- [ ] Fix the thing <!-- tribunal:ai:review-comment:RT_thread1:C_comment1 -->',
      },
    ];
    const derived: DerivedActionItem[] = [
      {
        id: 'review-comment:RT_thread1:C_comment1',
        description: 'Fix the thing',
        completed: false,
      },
    ];
    const state: ConversationState = {
      resolvedThreadIds: new Set(['RT_thread1']),
      allChecksPassing: false,
      passingCheckNames: new Set(),
    };

    const result = reconcileActionItems(existing, derived, state);

    expect(result[0].completed).toBe(true);
  });

  it('auto-completes a CI item when allChecksPassing is true', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'ci-check-lint',
        description: 'Fix lint',
        completed: false,
        rawLine: '- [ ] Fix lint <!-- tribunal:ai:ci-check-lint -->',
      },
    ];
    const derived: DerivedActionItem[] = [
      { id: 'ci-check-lint', description: 'Fix lint', completed: false },
    ];
    const state: ConversationState = {
      resolvedThreadIds: new Set(),
      allChecksPassing: true,
      passingCheckNames: new Set(),
    };

    const result = reconcileActionItems(existing, derived, state);

    expect(result[0].completed).toBe(true);
  });

  it('auto-completes a CI item when that specific check name is in passingCheckNames', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'ci-check-typecheck',
        description: 'Fix type errors',
        completed: false,
        rawLine: '- [ ] Fix type errors <!-- tribunal:ai:ci-check-typecheck -->',
      },
    ];
    const derived: DerivedActionItem[] = [
      { id: 'ci-check-typecheck', description: 'Fix type errors', completed: false },
    ];
    const state: ConversationState = {
      resolvedThreadIds: new Set(),
      allChecksPassing: false,
      passingCheckNames: new Set(['typecheck']),
    };

    const result = reconcileActionItems(existing, derived, state);

    expect(result[0].completed).toBe(true);
  });

  it('does NOT auto-complete a CI item when a different check is passing', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'ci-check-typecheck',
        description: 'Fix type errors',
        completed: false,
        rawLine: '- [ ] Fix type errors <!-- tribunal:ai:ci-check-typecheck -->',
      },
    ];
    const derived: DerivedActionItem[] = [
      { id: 'ci-check-typecheck', description: 'Fix type errors', completed: false },
    ];
    const state: ConversationState = {
      resolvedThreadIds: new Set(),
      allChecksPassing: false,
      passingCheckNames: new Set(['lint']), // different check
    };

    const result = reconcileActionItems(existing, derived, state);

    expect(result[0].completed).toBe(false);
  });
});

// ============================================================================
// reconcileActionItems — orphan preservation (never-delete contract)
// ============================================================================

describe('reconcileActionItems — orphan preservation', () => {
  it('keeps items that are in existing but absent from derived', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-comment:RT_old:C_1',
        description: 'Old comment that was deleted',
        completed: false,
        rawLine: '- [ ] Old comment <!-- tribunal:ai:review-comment:RT_old:C_1 -->',
      },
    ];
    const derived: DerivedActionItem[] = []; // nothing derived now

    const result = reconcileActionItems(existing, derived, emptyState());

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('review-comment:RT_old:C_1');
  });

  it('auto-completes an orphaned review thread item when its thread is resolved', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-thread-RT_gone',
        description: 'Fix the API',
        completed: false,
        rawLine: '- [ ] Fix the API <!-- tribunal:ai:review-thread-RT_gone -->',
      },
    ];
    const derived: DerivedActionItem[] = []; // no longer derived
    const state: ConversationState = {
      resolvedThreadIds: new Set(['RT_gone']),
      allChecksPassing: false,
      passingCheckNames: new Set(),
    };

    const result = reconcileActionItems(existing, derived, state);

    expect(result[0].completed).toBe(true);
  });

  it('preserves human-checked orphaned items regardless of conversation state', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-comment:RT_x:C_y',
        description: 'Already done manually',
        completed: true,
        rawLine: '- [x] ~~Already done manually~~ <!-- tribunal:ai:review-comment:RT_x:C_y -->',
      },
    ];
    const derived: DerivedActionItem[] = [];

    const result = reconcileActionItems(existing, derived, emptyState());

    expect(result[0].completed).toBe(true);
  });

  it('includes both new derived items and orphaned existing items in the output', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-comment:RT_old:C_1',
        description: 'Old item',
        completed: false,
        rawLine: '- [ ] Old item <!-- tribunal:ai:review-comment:RT_old:C_1 -->',
      },
    ];
    const derived: DerivedActionItem[] = [
      { id: 'ci-check-lint', description: 'Fix lint', completed: false },
    ];

    const result = reconcileActionItems(existing, derived, emptyState());

    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.id);
    expect(ids).toContain('ci-check-lint');
    expect(ids).toContain('review-comment:RT_old:C_1');
  });

  it('hard-filters bot-noise items from the existing list during the healing pass', () => {
    const existing: ParsedActionItem[] = [
      {
        id: 'review-comment:RT_bot:C_1',
        description: 'dependabot[bot] opened a PR for you',
        completed: false,
        rawLine: '- [ ] dependabot[bot] opened <!-- tribunal:ai:review-comment:RT_bot:C_1 -->',
      },
    ];
    const derived: DerivedActionItem[] = [];

    const result = reconcileActionItems(existing, derived, emptyState());

    // bot_noise → hard-filtered → removed from result
    expect(result).toHaveLength(0);
  });

  it('heals an over-long existing description with a deterministic summary', () => {
    const longDescription = 'A'.repeat(250);
    const existing: ParsedActionItem[] = [
      {
        id: 'review-comment:RT_long:C_1',
        description: longDescription,
        completed: false,
        rawLine: `- [ ] ${longDescription} <!-- tribunal:ai:review-comment:RT_long:C_1 -->`,
      },
    ];

    const result = reconcileActionItems(existing, [], emptyState());

    expect(result).toHaveLength(1);
    expect(result[0].description).toBe(deterministicSummary(longDescription));
    expect(result[0].description.length).toBeLessThan(longDescription.length);
  });
});

// ============================================================================
// deterministicSummary
// ============================================================================

describe('deterministicSummary', () => {
  it('strips a leading "- " list marker prefix (the [ ] bracket is not a markdown prefix)', () => {
    // MARKDOWN_PREFIX_REGEX strips [>#*-] characters followed by whitespace.
    // "- [ ] text" → strip "- " → "[ ] text" (bracket content is preserved).
    expect(deterministicSummary('- [ ] Add null check')).toBe('[ ] Add null check');
  });

  it('strips a leading "## " heading prefix', () => {
    expect(deterministicSummary('## Section heading')).toBe('Section heading');
  });

  it('strips a leading "> " blockquote prefix', () => {
    expect(deterministicSummary('> Quoted text')).toBe('Quoted text');
  });

  it('strips multiple chained prefixes', () => {
    // "- > text" — leading dash+space+gt+space
    expect(deterministicSummary('- > Nested')).toBe('Nested');
  });

  it('takes the first non-empty line of multi-line input', () => {
    const body = '\n\nFirst real line\nSecond line\nThird line';
    expect(deterministicSummary(body)).toBe('First real line');
  });

  it('skips blank lines and leading-prefix-only lines to find the first non-empty line', () => {
    const body = '##\n\n## Real heading content';
    expect(deterministicSummary(body)).toBe('Real heading content');
  });

  it('truncates lines longer than 120 characters with an ellipsis', () => {
    const long = 'A'.repeat(130);
    const result = deterministicSummary(long);

    expect(result).toHaveLength(120);
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not truncate lines that are exactly 120 characters', () => {
    const exactly = 'B'.repeat(120);
    expect(deterministicSummary(exactly)).toBe(exactly);
  });

  it('falls back to "Address review feedback" when the body is empty', () => {
    expect(deterministicSummary('')).toBe('Address review feedback');
  });

  it('falls back to "Address review feedback" when the body is whitespace-only', () => {
    expect(deterministicSummary('   \n\n  \t  ')).toBe('Address review feedback');
  });
});

// ============================================================================
// sanitizeActionItemCandidate
// ============================================================================

describe('sanitizeActionItemCandidate', () => {
  it('passes a genuine human review comment through', () => {
    const result = sanitizeActionItemCandidate(
      'Please add input validation before calling the API.',
      'review-comment:RT_1:C_1',
    );

    expect(result.filtered).toBe(false);
    expect(result.sanitized).toBe('Please add input validation before calling the API.');
    expect(result.reason).toBeUndefined();
  });

  it('filters a [bot] tagged input as bot_noise', () => {
    const result = sanitizeActionItemCandidate(
      'dependabot[bot] wants to update your dependency.',
      'review-comment:RT_2:C_2',
    );

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('bot_noise');
    expect(result.sanitized).toBe('');
  });

  it('filters a codecov report as bot_noise', () => {
    const result = sanitizeActionItemCandidate(
      'codecov/project coverage decreased by 2%.',
      'ci-check-coverage',
    );

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('bot_noise');
  });

  it('filters a JSON blob as opaque_blob', () => {
    const result = sanitizeActionItemCandidate(
      '{"key": "value", "nested": {"a": 1}}',
      'issue-comment-42',
    );

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('opaque_blob');
    expect(result.sanitized).toBe('');
  });

  it('filters a JSON array as opaque_blob', () => {
    const result = sanitizeActionItemCandidate('[1, 2, 3]', 'issue-comment-43');

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('opaque_blob');
  });

  it('does not filter brace-wrapped text that only looks like JSON but fails to parse', () => {
    const result = sanitizeActionItemCandidate(
      '{ this is not valid json, just a sentence in curly braces }',
      'issue-comment-44',
    );

    expect(result.filtered).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('filters a version control payload ([vc]: prefix) as version_control_payload', () => {
    const result = sanitizeActionItemCandidate(
      '[vc]: blob data goes here',
      'review-comment:RT_3:C_3',
    );

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('version_control_payload');
    expect(result.sanitized).toBe('');
  });

  it('filters a [VC]: prefix (case-insensitive) as version_control_payload', () => {
    const result = sanitizeActionItemCandidate('[VC]: BLOB DATA', 'review-comment:RT_4:C_4');

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('version_control_payload');
  });

  it('filters empty content as empty_content', () => {
    const result = sanitizeActionItemCandidate('   ', 'some-source');

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('empty_content');
  });

  it('soft-filters content shorter than 10 characters as too_short (returns normalized text)', () => {
    const result = sanitizeActionItemCandidate('Fix it', 'short-source');

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('too_short');
    // Soft filter: sanitized still holds the normalized form
    expect(result.sanitized).toBe('Fix it');
  });

  it('filters a CI build status update as ci_status_update', () => {
    const result = sanitizeActionItemCandidate('Build succeeded on main branch.', 'ci-check-build');

    expect(result.filtered).toBe(true);
    expect(result.reason).toBe('ci_status_update');
    // Soft filter: sanitized is non-empty
    expect(result.sanitized).toBeTruthy();
  });

  it('does NOT filter a human comment that mentions dependabot in passing', () => {
    const result = sanitizeActionItemCandidate(
      'Update the dependabot configuration to include security patches.',
      'review-comment:RT_5:C_5',
    );

    // "Update the dependabot" starts with "Update", not "dependabot"
    expect(result.filtered).toBe(false);
  });

  it('normalizes excess whitespace in passing content', () => {
    const result = sanitizeActionItemCandidate(
      'Please   add    some   documentation  here.',
      'review-comment:RT_6:C_6',
    );

    expect(result.filtered).toBe(false);
    expect(result.sanitized).toBe('Please add some documentation here.');
  });
});

// ============================================================================
// extractSourceType
// ============================================================================

describe('extractSourceType', () => {
  it('maps "review-comment:..." to review_comment', () => {
    expect(extractSourceType('review-comment:RT_abc:C_123')).toBe('review_comment');
  });

  it('maps legacy "review-thread-..." to review_comment', () => {
    expect(extractSourceType('review-thread-RT_abc123')).toBe('review_comment');
  });

  it('maps "issue-comment-..." to issue_comment', () => {
    expect(extractSourceType('issue-comment-42')).toBe('issue_comment');
  });

  it('maps "review-..." (non-thread, non-comment) to review', () => {
    expect(extractSourceType('review-REV_abc')).toBe('review');
  });

  it('does NOT map "review-thread-..." to review (thread checked first)', () => {
    // Confirms the prefix-ordering guarantee in extractSourceType
    expect(extractSourceType('review-thread-RT_xyz')).not.toBe('review');
    expect(extractSourceType('review-thread-RT_xyz')).toBe('review_comment');
  });

  it('maps "ci-check-..." to ci_check_run', () => {
    expect(extractSourceType('ci-check-lint')).toBe('ci_check_run');
    expect(extractSourceType('ci-check-typecheck')).toBe('ci_check_run');
  });

  it('maps an unrecognized key to composite', () => {
    expect(extractSourceType('unknown-key-abc')).toBe('composite');
    expect(extractSourceType('')).toBe('composite');
    expect(extractSourceType('some-random-id')).toBe('composite');
  });
});

// ============================================================================
// computeActionItemStatus
// ============================================================================

describe('computeActionItemStatus', () => {
  it('returns done when completed is true', () => {
    expect(
      computeActionItemStatus({
        completed: true,
        currentHeadSha: 'sha-abc',
        existingFirstSeenHeadSha: 'sha-abc',
      }),
    ).toBe('done');
  });

  it('returns pending when there is no current head SHA', () => {
    expect(
      computeActionItemStatus({
        completed: false,
        currentHeadSha: null,
        existingFirstSeenHeadSha: 'sha-old',
      }),
    ).toBe('pending');
  });

  it('returns pending for a brand-new item (no existingFirstSeenHeadSha)', () => {
    expect(
      computeActionItemStatus({
        completed: false,
        currentHeadSha: 'sha-new',
        existingFirstSeenHeadSha: null,
      }),
    ).toBe('pending');
  });

  it('returns in_progress when head SHA has changed since first seen', () => {
    expect(
      computeActionItemStatus({
        completed: false,
        currentHeadSha: 'sha-new',
        existingFirstSeenHeadSha: 'sha-old',
      }),
    ).toBe('in_progress');
  });

  it('returns pending when current SHA matches first-seen SHA (no progress yet)', () => {
    expect(
      computeActionItemStatus({
        completed: false,
        currentHeadSha: 'sha-same',
        existingFirstSeenHeadSha: 'sha-same',
      }),
    ).toBe('pending');
  });
});

// ============================================================================
// updatePRDescription — replace vs. append
// ============================================================================

describe('updatePRDescription', () => {
  const items: ActionItem[] = [
    { id: 'ci-check-lint', description: 'Fix CI: lint', completed: false },
  ];

  it('appends a new block when the body has no existing markers', () => {
    const body = 'Original PR description.';
    const updated = updatePRDescription(body, items);

    // Original text is preserved and the block is appended after it.
    expect(updated.startsWith('Original PR description.')).toBe(true);
    expect(updated).toContain('<!--TRIBUNAL-ACTION-ITEMS-START-->');
    expect(updated).toContain('<!--TRIBUNAL-ACTION-ITEMS-END-->');
    expect(updated).toContain('<!-- tribunal:ai:ci-check-lint -->');
  });

  it('replaces the existing block in place, leaving surrounding text intact', () => {
    // Build a body with an existing (stale) block between prose.
    const stale = renderActionItemsBlock([
      { id: 'ci-check-old', description: 'Fix CI: old', completed: true },
    ]);
    const body = `Intro paragraph.\n\n${stale}\n\nClosing paragraph.`;

    const updated = updatePRDescription(body, items);

    // Surrounding prose survives.
    expect(updated).toContain('Intro paragraph.');
    expect(updated).toContain('Closing paragraph.');
    // The new item replaced the stale one — exactly one block, new content only.
    expect(updated).toContain('<!-- tribunal:ai:ci-check-lint -->');
    expect(updated).not.toContain('ci-check-old');
    const startCount = updated.split('<!--TRIBUNAL-ACTION-ITEMS-START-->').length - 1;
    expect(startCount).toBe(1);
  });
});

// ============================================================================
// safeCheckKeySegment — CI check name → comment-safe stable key segment
// ============================================================================

describe('safeCheckKeySegment', () => {
  it('leaves a simple name byte-identical (legacy ci-check-{name} compat)', () => {
    // Existing PR bodies carry `ci-check-lint` markers; the segment must match
    // so reconciliation does not orphan them and create duplicates.
    expect(safeCheckKeySegment('lint')).toBe('lint');
    expect(safeCheckKeySegment('typecheck')).toBe('typecheck');
    expect(safeCheckKeySegment('build_and_test')).toBe('build_and_test');
  });

  it('replaces comment-breaking characters and collapses dashes (no --)', () => {
    // `>` and `--` are invalid inside <!-- ... --> and would corrupt parsing.
    const seg = safeCheckKeySegment('CI / test (ubuntu) > shard');
    expect(seg).not.toContain('--');
    expect(seg).not.toContain('>');
    expect(seg).not.toContain(' ');
    // A name already containing adjacent dashes must not yield `--`.
    expect(safeCheckKeySegment('ci--test')).toBe('ci-test');
    expect(safeCheckKeySegment('a -- b')).not.toContain('--');
  });

  it('has no leading/trailing dashes', () => {
    const seg = safeCheckKeySegment('  /weird/  ');
    expect(seg.startsWith('-')).toBe(false);
    expect(seg.endsWith('-')).toBe(false);
  });
});
