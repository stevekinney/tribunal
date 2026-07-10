import { describe, it, expect } from 'vitest';
import type { CIStatus, MergeStatus } from '@tribunal/database/schema';
import { isAttentionCiStatus, isAttentionMergeStatus, pullRequestNeedsAttention } from './types.js';

const ALL_CI_STATUSES: CIStatus[] = ['pending', 'passing', 'failing', 'error', 'unknown'];
const ALL_MERGE_STATUSES: MergeStatus[] = ['clean', 'conflicts', 'behind', 'blocked', 'unknown'];

describe('isAttentionCiStatus', () => {
  it.each([
    ['pending', false],
    ['passing', false],
    ['failing', true],
    ['error', true],
    ['unknown', false],
  ] as const)('classifies %s as attention=%s', (status, expected) => {
    expect.assertions(1);
    expect(isAttentionCiStatus(status)).toBe(expected);
  });

  it('covers every CIStatus value', () => {
    expect.assertions(1);
    const results = ALL_CI_STATUSES.map((status) => [status, isAttentionCiStatus(status)]);
    expect(results).toEqual([
      ['pending', false],
      ['passing', false],
      ['failing', true],
      ['error', true],
      ['unknown', false],
    ]);
  });
});

describe('isAttentionMergeStatus', () => {
  it.each([
    ['clean', false],
    ['conflicts', true],
    ['behind', false],
    ['blocked', false],
    ['unknown', false],
  ] as const)('classifies %s as attention=%s', (status, expected) => {
    expect.assertions(1);
    expect(isAttentionMergeStatus(status)).toBe(expected);
  });

  it('covers every MergeStatus value', () => {
    expect.assertions(1);
    const results = ALL_MERGE_STATUSES.map((status) => [status, isAttentionMergeStatus(status)]);
    expect(results).toEqual([
      ['clean', false],
      ['conflicts', true],
      ['behind', false],
      ['blocked', false],
      ['unknown', false],
    ]);
  });
});

describe('pullRequestNeedsAttention', () => {
  const base = {
    ciStatus: 'passing' as CIStatus,
    mergeStatus: 'clean' as MergeStatus,
    unresolvedThreadCount: 0,
  };

  it('is false when every signal is clean/passing/zero', () => {
    expect.assertions(1);
    expect(pullRequestNeedsAttention(base)).toBe(false);
  });

  it('is true when CI is failing', () => {
    expect.assertions(1);
    expect(pullRequestNeedsAttention({ ...base, ciStatus: 'failing' })).toBe(true);
  });

  it('is true when CI has errored', () => {
    expect.assertions(1);
    expect(pullRequestNeedsAttention({ ...base, ciStatus: 'error' })).toBe(true);
  });

  it('is true when the merge status is conflicts', () => {
    expect.assertions(1);
    expect(pullRequestNeedsAttention({ ...base, mergeStatus: 'conflicts' })).toBe(true);
  });

  it('is true when there are unresolved review threads', () => {
    expect.assertions(1);
    expect(pullRequestNeedsAttention({ ...base, unresolvedThreadCount: 2 })).toBe(true);
  });

  it('is false when unresolvedThreadCount is null (unknown, not zero)', () => {
    expect.assertions(1);
    expect(pullRequestNeedsAttention({ ...base, unresolvedThreadCount: null })).toBe(false);
  });

  it('is false when CI/merge status are unknown — an absent signal is not evidence of a problem', () => {
    expect.assertions(1);
    expect(
      pullRequestNeedsAttention({
        ciStatus: 'unknown',
        mergeStatus: 'unknown',
        unresolvedThreadCount: null,
      }),
    ).toBe(false);
  });

  it('is true when a repository is pending CI but has conflicts', () => {
    expect.assertions(1);
    expect(
      pullRequestNeedsAttention({ ...base, ciStatus: 'pending', mergeStatus: 'conflicts' }),
    ).toBe(true);
  });
});
