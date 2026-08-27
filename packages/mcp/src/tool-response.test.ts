import { describe, expect, it } from 'vitest';
import {
  createToolErrorResponse,
  createToolJsonResponse,
  createToolStructuredResponse,
  createToolTextResponse,
} from './tool-response.js';

const oneKilobyte = 1024;
const capBytes = 256 * oneKilobyte;

describe('createToolTextResponse', () => {
  it('returns the text unchanged when under the size limit', () => {
    const response = createToolTextResponse('hello');
    expect(response.content[0].text).toBe('hello');
    expect((response as { isError?: boolean }).isError).toBeUndefined();
  });

  it('replaces an oversized result with a stable error response rather than truncating it', () => {
    const hugeText = 'x'.repeat(300 * oneKilobyte);
    const response = createToolTextResponse(hugeText);
    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(response.content[0].text).not.toBe(hugeText);
    expect(response.content[0].text).toContain('exceeded');
    // The replacement message itself must be well under the limit.
    expect(response.content[0].text.length < 1024).toBe(true);
  });
});

describe('createToolJsonResponse', () => {
  it('serializes small data unchanged', () => {
    const response = createToolJsonResponse({ id: '1', name: 'Alice' });
    expect(response.content[0].text).toBe(JSON.stringify({ id: '1', name: 'Alice' }));
    expect((response as { isError?: boolean }).isError).toBeUndefined();
  });

  it('replaces an oversized JSON result with a stable error response', () => {
    const hugeArray = Array.from({ length: 50_000 }, (_, index) => ({ index, value: 'padding' }));
    const response = createToolJsonResponse(hugeArray);
    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(response.content[0].text).toContain('exceeded');
  });

  it('never throws on undefined data', () => {
    const response = createToolJsonResponse(undefined);
    expect(response.content[0].text).toBe('null');
  });
});

describe('createToolErrorResponse', () => {
  it('always marks isError true', () => {
    const response = createToolErrorResponse('something went wrong');
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe('something went wrong');
  });

  it('bounds an oversized error message too', () => {
    const hugeMessage = 'x'.repeat(300 * oneKilobyte);
    const response = createToolErrorResponse(hugeMessage);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).not.toBe(hugeMessage);
  });
});

describe('createToolStructuredResponse', () => {
  it('returns the summary as text content and the data as structuredContent when both are under the size limit', () => {
    const data = { id: '1', name: 'Alice' };
    const response = createToolStructuredResponse(data, 'Found user Alice');
    expect(response.content[0].text).toBe('Found user Alice');
    expect((response as { isError?: boolean }).isError).toBeUndefined();
    expect((response as { structuredContent?: unknown }).structuredContent).toEqual(data);
  });

  it('replaces an oversized summary with a stable error response, never reaching structuredContent', () => {
    const hugeSummary = 'x'.repeat(300 * oneKilobyte);
    const response = createToolStructuredResponse({ id: '1' }, hugeSummary);
    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(response.content[0].text).not.toBe(hugeSummary);
    expect(response.content[0].text).toContain('exceeded');
    expect((response as { structuredContent?: unknown }).structuredContent).toBeUndefined();
  });

  it('replaces an oversized structured payload with a stable error response even when the summary is small', () => {
    const hugeArray = Array.from({ length: 50_000 }, (_, index) => ({ index, value: 'padding' }));
    const response = createToolStructuredResponse(hugeArray, 'a small summary');
    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(response.content[0].text).toContain('exceeded');
    expect((response as { structuredContent?: unknown }).structuredContent).toBeUndefined();
  });

  /**
   * Acceptance criterion 8, exactly: a 257KB payload (one kilobyte over
   * the 256KB `boundedTextContent` cap) must produce `isError: true`
   * rather than truncated or malformed structured content. This is the
   * boundary case the cap exists for -- 300KB above already proves "well
   * over the cap fails," but does not prove the cap sits where it claims
   * to (`maxToolResultCharacters` could be off by an order of magnitude
   * and still pass a 300KB-vs-small-input test suite).
   */
  it('a 257KB structured payload produces isError: true, not truncated or malformed structuredContent', () => {
    const payloadOneKilobyteOverTheCap = { padding: 'x'.repeat(257 * oneKilobyte) };
    expect(JSON.stringify(payloadOneKilobyteOverTheCap).length).toBeGreaterThan(capBytes);

    const response = createToolStructuredResponse(payloadOneKilobyteOverTheCap, 'small summary');

    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(response.content[0].text).toContain('exceeded');
    expect((response as { structuredContent?: unknown }).structuredContent).toBeUndefined();
  });

  /**
   * The same boundary, proven through `createToolJsonResponse` too -- the
   * criterion's "malformed structured content" concern is specifically
   * about a truncated JSON string being handed back as if it were valid.
   * The replacement text must be the stable error message, never a JSON
   * fragment cut off mid-value (which `JSON.parse` would reject, but a
   * naive string-slicing truncation would silently produce).
   */
  it('a 257KB JSON payload produces isError: true with the stable error message, not a truncated JSON fragment', () => {
    const oversizedPayload = { padding: 'x'.repeat(257 * oneKilobyte) };
    const serialized = JSON.stringify(oversizedPayload);
    expect(serialized.length).toBeGreaterThan(capBytes);

    const response = createToolJsonResponse(oversizedPayload);

    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(response.content[0].text).toContain('exceeded');
    expect(response.content[0].text).not.toBe(serialized.slice(0, response.content[0].text.length));
  });

  /**
   * Review on #324 found the cap was enforced on `String.length`, which counts
   * UTF-16 code units rather than the UTF-8 bytes that go on the wire. The two
   * diverge by up to 3x for non-ASCII output, so a character-based check
   * silently permitted nearly three times the advertised limit -- criterion 8
   * passing while the guarantee it describes was absent.
   *
   * 200,000 CJK characters are comfortably under a 256*1024 CHARACTER cap and
   * comfortably over a 256*1024 BYTE one, so this test fails against the
   * character-based implementation and passes against the byte-based one.
   */
  it('a multi-byte payload under the character count but over the byte cap produces isError: true', () => {
    const multiByteText = '\u4e2d'.repeat(200_000);

    expect(multiByteText.length).toBeLessThan(capBytes);
    expect(new TextEncoder().encode(multiByteText).length).toBeGreaterThan(capBytes);

    const response = createToolTextResponse(multiByteText);

    expect((response as { isError?: boolean }).isError).toBe(true);
    expect(response.content[0].text).toContain('exceeded');
    expect(response.content[0].text).toContain('bytes');
  });

  it('an ASCII payload just under the byte cap is still returned intact', () => {
    // The fix must not reject what it exists to permit.
    const withinCap = 'x'.repeat(capBytes - 1024);
    const response = createToolTextResponse(withinCap);

    expect((response as { isError?: boolean }).isError).toBeUndefined();
    expect(response.content[0].text).toBe(withinCap);
  });
});
