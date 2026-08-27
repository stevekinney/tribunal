import { describe, expect, it } from 'vitest';
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
import {
  readProgressToken,
  readSessionIdentifier,
  readNotificationSender,
  readRequestSender,
  stringifyUnknown,
  parseSampledText,
  assertSamplingSupport,
} from './handler-context';

describe('readProgressToken', () => {
  it('returns undefined for undefined', () => {
    expect(readProgressToken(undefined)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(readProgressToken(null)).toBeUndefined();
  });

  it('returns undefined for a non-object', () => {
    expect(readProgressToken('string')).toBeUndefined();
  });

  it('returns the progressToken from mcpReq._meta', () => {
    expect(readProgressToken({ mcpReq: { _meta: { progressToken: 'tok-1' } } })).toBe('tok-1');
  });

  it('returns a numeric progressToken', () => {
    expect(readProgressToken({ mcpReq: { _meta: { progressToken: 42 } } })).toBe(42);
  });
});

describe('readSessionIdentifier', () => {
  it('returns undefined for undefined', () => {
    expect(readSessionIdentifier(undefined)).toBeUndefined();
  });

  it('returns the sessionId when present', () => {
    expect(readSessionIdentifier({ sessionId: 'sess-abc' })).toBe('sess-abc');
  });
});

describe('readNotificationSender', () => {
  it('returns undefined when ctx is undefined', () => {
    expect(readNotificationSender(undefined)).toBeUndefined();
  });

  it('returns undefined when mcpReq.notify is not a function', () => {
    expect(readNotificationSender({ mcpReq: { notify: 'not-a-function' } })).toBeUndefined();
  });

  it('returns the function when mcpReq.notify is a function', () => {
    const sender = async () => {};
    expect(readNotificationSender({ mcpReq: { notify: sender } })).toBe(sender);
  });
});

describe('readRequestSender', () => {
  it('returns undefined when ctx is undefined', () => {
    expect(readRequestSender(undefined)).toBeUndefined();
  });

  it('returns undefined when mcpReq.send is not a function', () => {
    expect(readRequestSender({ mcpReq: { send: 123 } })).toBeUndefined();
  });

  it('returns the function when mcpReq.send is a function', () => {
    const sender = async () => ({});
    expect(readRequestSender({ mcpReq: { send: sender } })).toBe(sender);
  });
});

describe('stringifyUnknown', () => {
  it('returns a string as-is', () => {
    expect(stringifyUnknown('hello')).toBe('hello');
  });

  it('JSON-stringifies an object', () => {
    expect(stringifyUnknown({ key: 'value' })).toBe('{"key":"value"}');
  });

  it('falls back to String() for circular references', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(stringifyUnknown(circular)).toBe('[object Object]');
  });
});

describe('parseSampledText', () => {
  it('extracts text from array content', () => {
    const result = { content: [{ text: 'sampled text', type: 'text' }] };
    expect(parseSampledText(result)).toBe('sampled text');
  });

  it('extracts text from single object content', () => {
    const result = { content: { text: 'direct text' } };
    expect(parseSampledText(result)).toBe('direct text');
  });

  it('falls back to stringifyUnknown for unrecognized shapes', () => {
    const result = { unexpected: 'data' };
    expect(parseSampledText(result)).toBe('{"unexpected":"data"}');
  });

  it('falls back to stringifyUnknown when array content has a non-string text field', () => {
    const result = { content: [{ text: 42 }] };
    expect(parseSampledText(result)).toBe('{"content":[{"text":42}]}');
  });

  it('falls back to stringifyUnknown when object content has a non-string text field', () => {
    const result = { content: { text: 42 } };
    expect(parseSampledText(result)).toBe('{"content":{"text":42}}');
  });
});

describe('assertSamplingSupport', () => {
  it('does not throw when mcpReq.send is present', () => {
    expect(() => assertSamplingSupport({ mcpReq: { send: async () => ({}) } })).not.toThrow();
  });

  it('throws ProtocolError when mcpReq.send is absent', () => {
    expect(() => assertSamplingSupport({})).toThrow(ProtocolError);
    try {
      assertSamplingSupport({});
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe(ProtocolErrorCode.InvalidRequest);
    }
  });
});
