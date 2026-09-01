import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { tribunalGoldenPrompts, type GoldenPromptCategory } from './golden-prompts';
import { tribunalMcpOperations } from './registry';

vi.mock('$env/dynamic/private', () => ({ env: { MCP_SERVER_NAME: 'tribunal-mcp-server' } }));

const everyCategory: GoldenPromptCategory[] = [
  'intended-tool-use',
  'disallowed-tool-use',
  'parameter-extraction',
  'authentication-interruption',
  'untrusted-content-handling',
];

function parameterNamesOf(operation: keyof typeof tribunalMcpOperations): string[] {
  const schema = tribunalMcpOperations[operation].inputSchema as z.ZodObject<z.ZodRawShape>;
  return Object.keys(schema.shape);
}

describe('golden-prompt specification', () => {
  it('covers every review category', () => {
    expect.assertions(5);
    const covered = new Set(tribunalGoldenPrompts.map((prompt) => prompt.category));

    for (const category of everyCategory) {
      expect(covered.has(category)).toBe(true);
    }
  });

  it('gives every case a unique id', () => {
    expect.assertions(1);
    const ids = tribunalGoldenPrompts.map((prompt) => prompt.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('states a prompt and an expected behaviour for every case', () => {
    expect.assertions(tribunalGoldenPrompts.length * 2);

    for (const prompt of tribunalGoldenPrompts) {
      expect(prompt.prompt.length).toBeGreaterThan(0);
      expect(prompt.expectedBehavior.length).toBeGreaterThan(0);
    }
  });

  it('names only operations the production registry actually serves', () => {
    expect.assertions(1);
    const named = tribunalGoldenPrompts
      .map((prompt) => prompt.operation)
      .filter((operation): operation is keyof typeof tribunalMcpOperations => operation !== null);

    expect(named.every((operation) => operation in tribunalMcpOperations)).toBe(true);
  });

  it('pairs every case with the scope its own operation requires', () => {
    expect.assertions(1);
    const mismatched = tribunalGoldenPrompts.filter(
      (prompt) =>
        prompt.operation !== null &&
        prompt.requiredScope !== tribunalMcpOperations[prompt.operation].requiredScope,
    );

    expect(mismatched).toEqual([]);
  });

  it("expects only parameters that exist on the operation's own input schema", () => {
    expect.assertions(1);
    const unknownParameters = tribunalGoldenPrompts.flatMap((prompt) =>
      prompt.operation === null
        ? []
        : prompt.expectedParameters
            .filter((parameter) => !parameterNamesOf(prompt.operation).includes(parameter))
            .map((parameter) => `${prompt.id}: ${parameter}`),
    );

    expect(unknownParameters).toEqual([]);
  });

  it('reaches no production operation from a disallowed-use case', () => {
    expect.assertions(2);
    const disallowed = tribunalGoldenPrompts.filter(
      (prompt) => prompt.category === 'disallowed-tool-use',
    );

    expect(disallowed.length).toBeGreaterThan(0);
    expect(disallowed.every((prompt) => prompt.operation === null)).toBe(true);
  });

  it('leaves scope and parameters empty on cases that reach no operation', () => {
    expect.assertions(1);
    const inconsistent = tribunalGoldenPrompts.filter(
      (prompt) =>
        prompt.operation === null &&
        (prompt.requiredScope !== null || prompt.expectedParameters.length > 0),
    );

    expect(inconsistent).toEqual([]);
  });

  it('exercises every operation the server serves', () => {
    expect.assertions(1);
    const exercised = new Set(
      tribunalGoldenPrompts
        .map((prompt) => prompt.operation)
        .filter((operation): operation is keyof typeof tribunalMcpOperations => operation !== null),
    );

    expect([...exercised].sort()).toEqual(Object.keys(tribunalMcpOperations).sort());
  });
});
