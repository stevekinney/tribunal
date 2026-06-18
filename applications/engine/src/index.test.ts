import { describe, expect, it } from 'vitest';
import { createEngineServerOptions, parsePort } from './index';

describe('parsePort', () => {
  it('uses the parsed port when PORT is valid', () => {
    expect(parsePort('4321', 3001)).toBe(4321);
  });

  it('falls back when PORT is invalid', () => {
    expect(parsePort('not-a-port', 3001)).toBe(3001);
    expect(parsePort('70000', 3001)).toBe(3001);
  });
});

describe('createEngineServerOptions', () => {
  it('drains review intents through the runtime endpoint', async () => {
    const server = createEngineServerOptions(3001, {
      engine: {},
      drainReviewIntents: async () => 3,
      release: async () => {},
    });

    const response = await server.fetch(
      new Request('http://engine.test/review-intents/drain', {
        method: 'POST',
      }),
    );

    await expect(response.json()).resolves.toEqual({ ok: true, processed: 3 });
  });
});
