import { describe, expect, it } from 'vitest';
import { parsePort } from './index';

describe('parsePort', () => {
  it('uses the parsed port when PORT is valid', () => {
    expect(parsePort('4321', 3001)).toBe(4321);
  });

  it('falls back when PORT is invalid', () => {
    expect(parsePort('not-a-port', 3001)).toBe(3001);
    expect(parsePort('70000', 3001)).toBe(3001);
  });
});
