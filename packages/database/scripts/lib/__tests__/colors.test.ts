import { describe, expect, test } from 'bun:test';

import { success, error, info, sectionHeader, checkmark, cross } from '../colors';

describe('colors from packages/database/scripts/lib', () => {
  test('exports expected color functions', () => {
    expect(typeof success).toBe('function');
    expect(typeof error).toBe('function');
    expect(typeof info).toBe('function');
    expect(typeof sectionHeader).toBe('function');
  });

  test('exports expected symbols', () => {
    expect(typeof checkmark).toBe('string');
    expect(typeof cross).toBe('string');
  });
});
