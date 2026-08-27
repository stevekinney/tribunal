import { describe, expect, it } from 'vitest';
import {
  createTestContext,
  expectToolError,
  expectToolJsonContent,
  expectToolSuccess,
} from './index';

/**
 * Every existing test in this package imports these helpers through their
 * relative internal paths (`./context.js`/`./tool-assertions.js`), never
 * through this barrel (`@tribunal/mcp/testing`), so `testing/index.ts`
 * never appeared in the coverage report at all. This tests the barrel's
 * re-exports directly, and -- since these are themselves test utilities --
 * genuinely tests their behavior: `expectToolSuccess`/`expectToolError`
 * must actually distinguish a well-formed success result from an
 * error-shaped one (and fail the assertion when handed the wrong shape),
 * and `expectToolJsonContent` must actually parse the JSON text content.
 */
describe('testing barrel (./testing/index.ts)', () => {
  it('re-exports createTestContext with real defaults', () => {
    const context = createTestContext();
    expect(context.userId).toBe('test-user-00000000-0000-0000-0000-000000000000');
    expect(context.user.email).toBe('test@example.com');
  });

  it('createTestContext applies overrides', () => {
    const context = createTestContext({ userId: 'custom-id', user: { name: 'Custom Name' } });
    expect(context.userId).toBe('custom-id');
    expect(context.user.id).toBe('custom-id');
    expect(context.user.name).toBe('Custom Name');
  });

  it('expectToolSuccess passes for a well-formed, non-error result', () => {
    expect(() => expectToolSuccess({ content: [{ type: 'text', text: 'ok' }] })).not.toThrow();
  });

  it('expectToolSuccess fails for a result marked isError', () => {
    expect(() =>
      expectToolSuccess({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    ).toThrow();
  });

  it('expectToolError passes for a result marked isError', () => {
    expect(() =>
      expectToolError({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    ).not.toThrow();
  });

  it('expectToolError fails for a well-formed, non-error result', () => {
    expect(() => expectToolError({ content: [{ type: 'text', text: 'ok' }] })).toThrow();
  });

  it('expectToolJsonContent parses JSON text content and returns the parsed value', () => {
    const parsed = expectToolJsonContent({
      content: [{ type: 'text', text: JSON.stringify({ hello: 'world' }) }],
    });
    expect(parsed).toEqual({ hello: 'world' });
  });

  it('expectToolJsonContent throws when the content is missing text', () => {
    expect(() => expectToolJsonContent({ content: [{ type: 'text' }] })).toThrow();
  });
});
