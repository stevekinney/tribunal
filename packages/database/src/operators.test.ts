import { describe, expect, it } from 'vitest';
import * as drizzle from 'drizzle-orm';
import * as operators from './operators.js';

describe('operators re-export', () => {
  it('re-exports each query operator as the same drizzle-orm reference', () => {
    // The module's entire contract is instance identity: consumers importing
    // operators from here must receive the exact drizzle-orm functions that
    // built the schema, or private-property type checks diverge.
    const names = [
      'and',
      'asc',
      'desc',
      'eq',
      'gt',
      'gte',
      'ilike',
      'inArray',
      'isNull',
      'lt',
      'lte',
      'ne',
      'not',
      'notInArray',
      'or',
      'sql',
    ] as const;

    for (const name of names) {
      expect(operators[name]).toBe(drizzle[name]);
    }
  });
});
