import { describe, expect, it } from 'vitest';
import { csr, prerender } from './+layout';

describe('(public) layout config', () => {
  it('prerenders and disables client-side routing for the public route group', () => {
    expect(prerender).toBe(true);
    expect(csr).toBe(false);
  });
});
