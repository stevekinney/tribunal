import { describe, expect, it } from 'vitest';
import { isServerOnlyCloseableStream, markServerOnlyCloseableStream } from './stream-lifecycle';

describe('server-only-closeable stream tagging (TRI-43)', () => {
  it('reports a response as server-only closeable only after it is marked', () => {
    const response = new Response('stream');
    expect(isServerOnlyCloseableStream(response)).toBe(false);

    const marked = markServerOnlyCloseableStream(response);
    // The same Response is returned so the serving layer keeps streaming it.
    expect(marked).toBe(response);
    expect(isServerOnlyCloseableStream(response)).toBe(true);
  });

  it('leaves an unmarked response unaffected, so ordinary requests are not excluded', () => {
    expect(isServerOnlyCloseableStream(new Response('ordinary'))).toBe(false);
  });
});
