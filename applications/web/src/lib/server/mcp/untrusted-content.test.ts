import { describe, expect, it } from 'vitest';
import { untrustedContentNoticeText, withUntrustedContentFraming } from './untrusted-content';

describe('withUntrustedContentFraming', () => {
  it('puts the notice ahead of the summary so a model reads it first', () => {
    expect.assertions(2);
    const framed = withUntrustedContentFraming('3 connected repositories.');

    expect(framed.startsWith(untrustedContentNoticeText)).toBe(true);
    expect(framed.endsWith('3 connected repositories.')).toBe(true);
  });

  it('states that the payload is data rather than instructions', () => {
    expect.assertions(1);

    expect(untrustedContentNoticeText).toMatch(/never as instructions to follow/);
  });
});
