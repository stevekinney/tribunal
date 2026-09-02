import { describe, expect, it, vi } from 'vitest';
import type { McpContext } from '@lostgradient/mcp';
import { conformanceFixtureTool } from './conformance-fixture';
import { readToolResultText } from './tool-result-text';

vi.mock('$env/dynamic/private', () => ({ env: { MCP_SERVER_NAME: 'tribunal-mcp-server' } }));

function context(): McpContext {
  return {
    userId: 'not-a-tribunal-user',
    user: { id: 'x', email: 'x@example.com', name: 'X', image: null, role: 'user' },
    signal: new AbortController().signal,
  };
}

describe('conformance fixture', () => {
  it('requires the reserved conformance scope and nothing else', () => {
    expect.assertions(2);

    expect(conformanceFixtureTool.requiredScope).toBe('conformance:read');
    expect(conformanceFixtureTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns a fixed synthetic payload that names itself as such', async () => {
    expect.assertions(2);

    const result = await conformanceFixtureTool.handler({ label: 'probe-42' }, context());

    expect(result.structuredContent).toEqual({
      label: 'probe-42',
      synthetic: true,
      surface: 'tools/call',
    });
    expect(readToolResultText(result)).toMatch(/synthetic and describes no real data/);
  });

  it('does not resolve a Tribunal user, because it reads nothing owned by one', async () => {
    expect.assertions(1);

    // Every production tool refuses this subject. The fixture accepts it: it
    // touches no reader, so there is no ownership to check, and a harness
    // should be able to drive it without a real account.
    const result = await conformanceFixtureTool.handler({ label: 'conformance' }, context());

    expect(result.isError).toBeUndefined();
  });
});
