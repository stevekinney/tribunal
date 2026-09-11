import { afterEach, describe, expect, it } from 'vitest';
import {
  McpConcurrencyLimiter,
  attachConcurrencySlotToResponseLifetime,
  createInMemoryConcurrencySlotStore,
} from '@lostgradient/mcp/rate-limit';
import {
  startAdapterNodeHarness,
  type AdapterNodeHarness,
} from '$testing/mcp/adapter-node-harness';
import { mcpBaseUrl } from '$lib/server/oauth/configuration';

/**
 * Verifies the MCP concurrency cap (TRI-56 AC5): the cap holds against a
 * long-lived streaming response (a slot is held for the stream's lifetime, not
 * released the instant the handler returns), and — the cross-runtime question
 * Tribunal owns (TRI-100) — whether a client disconnect under @sveltejs/adapter-node
 * releases the slot. The library's slot mechanism is TRI-103's; these prove
 * Tribunal's runtime behavior around it.
 */

const BASE = mcpBaseUrl.origin;
const KEY = 'rate_limit:mcp_concurrent:probe-user';

let harnesses: AdapterNodeHarness[] = [];
afterEach(async () => {
  await Promise.all(harnesses.map((harness) => harness.close()));
  harnesses = [];
});

describe('TRI-56 AC5 — the concurrency cap holds and slots track the response lifetime', () => {
  it('denies a second acquire while the first slot is held, and re-admits after release', async () => {
    const limiter = new McpConcurrencyLimiter(createInMemoryConcurrencySlotStore(), 1);

    const first = await limiter.acquire(KEY);
    expect(first.allowed).toBe(true);
    // With the first slot still held (as an open stream would hold it), the cap of
    // one refuses the second — this is what a naive `finally { release() }` breaks.
    expect((await limiter.acquire(KEY)).allowed).toBe(false);

    await first.release();
    expect((await limiter.acquire(KEY)).allowed).toBe(true);
  });

  it("holds the slot for a streaming response's lifetime, releasing on stream close", async () => {
    let released = false;
    const slot = {
      allowed: true as const,
      renewalIntervalMilliseconds: 20_000,
      release: async () => {
        released = true;
      },
      renew: async () => {},
    };
    // A stream that emits one chunk then closes.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const wrapped = attachConcurrencySlotToResponseLifetime(
      new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      slot,
    );

    // The slot is NOT released just because the handler returned the response…
    expect(released).toBe(false);
    // …it is released when the stream is fully consumed (or cancelled/errored).
    await wrapped.text();
    expect(released).toBe(true);
  });
});

describe('TRI-56 AC5 — disconnect probe under adapter-node', () => {
  it('reports whether a client disconnect releases the concurrency slot', async () => {
    const limiter = new McpConcurrencyLimiter(createInMemoryConcurrencySlotStore(), 1);

    async function dispatch(): Promise<Response> {
      const slot = await limiter.acquire(KEY);
      if (!slot.allowed) return new Response('busy', { status: 429 });
      // A stream that stays open, so the slot is held for the connection's life.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(': open\n\n'));
        },
      });
      return attachConcurrencySlotToResponseLifetime(
        new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
        slot,
      );
    }

    const harness = await startAdapterNodeHarness({
      base: BASE,
      bodySizeLimit: 1_048_576,
      dispatch,
    });
    harnesses.push(harness);

    // Client 1 opens the stream and reads a chunk, holding the only slot.
    const abort = new AbortController();
    const streamed = await fetch(`${harness.origin}/mcp`, { signal: abort.signal });
    const reader = streamed.body!.getReader();
    await reader.read();

    // The cap holds against the open stream: a second request is refused.
    const secondWhileOpen = await fetch(`${harness.origin}/mcp`);
    await secondWhileOpen.text();
    expect(secondWhileOpen.status).toBe(429);

    // Client 1 disconnects.
    await reader.cancel().catch(() => {});
    abort.abort();

    // Poll (bounded) for the slot becoming re-acquirable.
    let reacquired = false;
    for (let attempt = 0; attempt < 30 && !reacquired; attempt += 1) {
      const probe = await fetch(`${harness.origin}/mcp`).catch(() => null);
      if (probe && probe.status === 200) {
        reacquired = true;
        await probe.body?.cancel().catch(() => {});
      } else if (probe) {
        await probe.text().catch(() => {});
      }
      if (!reacquired) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // A deterministic, checkable outcome (AC5): under this runtime the disconnect
    // DOES release the slot, so it becomes re-acquirable within the bound.
    expect(reacquired).toBe(true);
  });
});
