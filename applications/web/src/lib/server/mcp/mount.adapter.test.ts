import { describe, expect, it } from 'vitest';
// The mount's per-user handler cache and subscription state live in-process, so
// the deployment adapter must be a long-lived one. adapter-node satisfies this;
// an edge or serverless adapter would break `subscriptions/listen` silently.
import config from '../../../../svelte.config.js';

describe('deployment adapter', () => {
  it('targets the long-lived @sveltejs/adapter-node', () => {
    const adapter = (config as { kit: { adapter: { name: string } } }).kit.adapter;
    expect(adapter.name).toBe('@sveltejs/adapter-node');
  });
});
