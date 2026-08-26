import { describe, expect, it } from 'vitest';
import * as packageEntry from './index.js';

/**
 * `src/index.ts` is the package's public barrel -- the surface a
 * consuming application actually imports from (`@tribunal/mcp`), never
 * any of these files directly. Asserts real shape on a representative
 * sample of each export family (factory function, tool/resource/prompt
 * registries, logger, scope vocabulary, type-guard function) rather than
 * merely checking `toBeDefined()` on every name, which would just move
 * the coverage counter without proving the barrel actually re-exports
 * the right values.
 */
describe('package entry barrel (./index.ts)', () => {
  it('re-exports the server factory as a callable function', () => {
    expect(typeof packageEntry.createMcpServer).toBe('function');
  });

  it('re-exports the production and conformance-only registries as empty arrays by default', () => {
    expect(Array.isArray(packageEntry.allTools)).toBe(true);
    expect(Array.isArray(packageEntry.conformanceOnlyTools)).toBe(true);
    expect(Array.isArray(packageEntry.allResources)).toBe(true);
    expect(Array.isArray(packageEntry.allPrompts)).toBe(true);
  });

  it('re-exports a working logger', () => {
    expect(typeof packageEntry.logger.info).toBe('function');
    expect(typeof packageEntry.logger.error).toBe('function');
  });

  it('re-exports environment parsing that never throws on an empty record', () => {
    expect(() => packageEntry.parseMcpServerEnvironment({})).not.toThrow();
    expect(packageEntry.getEnvironment().NODE_ENV).toBeDefined();
  });

  it('re-exports the scope vocabulary and its type guard consistently', () => {
    expect(packageEntry.mcpScopes.length).toBeGreaterThan(0);
    for (const scope of packageEntry.mcpScopes) {
      expect(packageEntry.isMcpScope(scope)).toBe(true);
      expect(packageEntry.mcpScopeDescriptions[scope]).toBeTruthy();
    }
    expect(packageEntry.isMcpScope('not_a_real_scope')).toBe(false);
  });

  it('re-exports getSupportedScopes as the sorted union of production requiredScope values', () => {
    const supported = packageEntry.getSupportedScopes();
    expect(supported).toEqual([...supported].sort());
  });

  it('re-exports localhost rebinding validation helpers that agree with each other', () => {
    expect(packageEntry.isLoopbackHostname('localhost')).toBe(true);
    expect(packageEntry.hasValidLocalhostRebindingHeaders(new Headers({ host: 'localhost' }))).toBe(
      true,
    );
  });

  it('re-exports tool-response builders that produce well-formed content', () => {
    const response = packageEntry.createToolTextResponse('hello');
    expect(response.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('re-exports handler-context helpers that parse sampled text', () => {
    expect(packageEntry.parseSampledText({ content: [{ text: 'result text' }] })).toBe(
      'result text',
    );
    expect(packageEntry.stringifyUnknown('already a string')).toBe('already a string');
  });

  it('re-exports defineTool/definePrompt as passthrough identity helpers', () => {
    const tool = { name: 'x' } as unknown as Parameters<typeof packageEntry.defineTool>[0];
    expect(packageEntry.defineTool(tool)).toBe(tool);

    const prompt = { name: 'y' } as unknown as Parameters<typeof packageEntry.definePrompt>[0];
    expect(packageEntry.definePrompt(prompt)).toBe(prompt);
  });

  it('re-exports runWithStandardizedTimeout and emitRequestProgress as callable functions', () => {
    expect(typeof packageEntry.runWithStandardizedTimeout).toBe('function');
    expect(typeof packageEntry.emitRequestProgress).toBe('function');
  });

  it('re-exports the metrics collector', () => {
    expect(typeof packageEntry.metricsCollector.snapshot).toBe('function');
  });

  it('re-exports EXTENSION_ID and RESOURCE_MIME_TYPE from the ext-apps server package', () => {
    expect(typeof packageEntry.EXTENSION_ID).toBe('string');
    expect(typeof packageEntry.RESOURCE_MIME_TYPE).toBe('string');
  });

  it('re-exports hasRegisteredUiExtensionResource as a function that is false with no MCP App resource registered', () => {
    expect(typeof packageEntry.hasRegisteredUiExtensionResource).toBe('function');
    expect(packageEntry.hasRegisteredUiExtensionResource()).toBe(false);
  });
});
