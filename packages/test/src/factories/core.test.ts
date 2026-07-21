import { describe, expect, it } from 'vitest';

import { generateId, resetIdCounter } from './core';

describe('generateId', () => {
  it('returns a strictly increasing sequence starting at 1 after a reset', () => {
    resetIdCounter();

    expect(generateId()).toBe(1);
    expect(generateId()).toBe(2);
    expect(generateId()).toBe(3);
  });
});

describe('resetIdCounter', () => {
  it('pins the next generated id back to 1, regardless of prior calls', () => {
    resetIdCounter();
    generateId();
    generateId();
    generateId();

    resetIdCounter();

    expect(generateId()).toBe(1);
    expect(generateId()).toBe(2);
  });
});
