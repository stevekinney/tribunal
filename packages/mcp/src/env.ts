import { z } from 'zod';

import { mcpServerEnvironmentSchema } from './environment-schema.js';

export type McpServerEnvironment = z.infer<z.ZodObject<typeof mcpServerEnvironmentSchema>>;

const mcpServerEnvironmentZodObject = z.object(mcpServerEnvironmentSchema);

/**
 * Parses a raw environment record (typically `process.env`) into a
 * validated `McpServerEnvironment`. A plain function rather than a
 * module-scope side effect: this package is imported by its own test
 * suite and, eventually, by a consuming application, neither of which
 * should have their import graph poisoned by a validation throw that ran
 * before anything asked for it.
 *
 * An empty string is treated as unset (rather than an invalid value for a
 * field with a `.default()`) so an environment variable declared but left
 * blank behaves the same as one never set at all.
 */
export function parseMcpServerEnvironment(
  env: Record<string, string | undefined>,
): McpServerEnvironment {
  const nonEmptyEnv: Record<string, string> = Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
    ),
  );
  return mcpServerEnvironmentZodObject.parse(nonEmptyEnv);
}

let cachedEnvironment: McpServerEnvironment | undefined;

/**
 * Lazily parses and memoizes `process.env` on first access. Callers that
 * need a fresh read against a mutated `process.env` (tests, primarily)
 * should call `parseMcpServerEnvironment(process.env)` directly instead.
 */
export function getEnvironment(): McpServerEnvironment {
  cachedEnvironment ??= parseMcpServerEnvironment(process.env);
  return cachedEnvironment;
}
