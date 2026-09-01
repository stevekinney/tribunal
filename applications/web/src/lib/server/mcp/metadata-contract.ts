import type { McpRegistry } from '@lostgradient/mcp';

/**
 * One way a registry can advertise something it cannot honour.
 *
 * `capability` is the wire name a client would see, so a violation names the
 * thing the client was promised rather than an index into an array.
 */
export type MetadataContractViolation = {
  capability: string;
  reason:
    | 'missing-name'
    | 'duplicate-name'
    | 'missing-title'
    | 'missing-description'
    | 'missing-handler'
    | 'missing-annotations'
    | 'contradictory-annotations'
    | 'write-capable-tool'
    | 'undeclared-scope';
};

type AdvertisedCapability = {
  name?: unknown;
  title?: unknown;
  description?: unknown;
  requiredScope?: unknown;
  handler?: unknown;
  annotations?: unknown;
};

const requiredAnnotationHints = [
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Checks that every capability a registry advertises is actually backed.
 *
 * This exists because "advertised" and "implemented" are separate facts, and
 * the engine only guarantees the first. A prior generation of this server
 * advertised an authorization capability that was a static allowlist behind
 * the scenes — the metadata was true about what was published and false about
 * what was enforced, and nothing failed.
 *
 * Written as a function over a registry rather than as assertions inside one
 * test so the check can be pointed at a deliberately broken registry too: a
 * contract test that can only ever be run against a passing input proves the
 * input passes, not that the check would catch a failure.
 */
export function findMetadataContractViolations(
  registry: McpRegistry,
  options: { isScope: (value: string) => boolean },
): MetadataContractViolation[] {
  const violations: MetadataContractViolation[] = [];
  const seenNames = new Set<string>();

  const capabilities: Array<{ entry: AdvertisedCapability; isTool: boolean }> = [
    ...registry.tools.map((entry) => ({ entry: entry as AdvertisedCapability, isTool: true })),
    ...registry.resources.map((entry) => ({ entry: entry as AdvertisedCapability, isTool: false })),
    ...registry.prompts.map((entry) => ({ entry: entry as AdvertisedCapability, isTool: false })),
  ];

  for (const { entry, isTool } of capabilities) {
    const capability = isNonEmptyString(entry.name) ? entry.name : '<unnamed>';

    if (!isNonEmptyString(entry.name)) {
      violations.push({ capability, reason: 'missing-name' });
    } else if (seenNames.has(entry.name)) {
      violations.push({ capability, reason: 'duplicate-name' });
    } else {
      seenNames.add(entry.name);
    }

    if (!isNonEmptyString(entry.title)) violations.push({ capability, reason: 'missing-title' });
    if (!isNonEmptyString(entry.description)) {
      violations.push({ capability, reason: 'missing-description' });
    }
    if (typeof entry.handler !== 'function') {
      violations.push({ capability, reason: 'missing-handler' });
    }
    if (!isNonEmptyString(entry.requiredScope) || !options.isScope(entry.requiredScope)) {
      violations.push({ capability, reason: 'undeclared-scope' });
    }

    if (!isTool) continue;

    const annotations = entry.annotations as Record<string, unknown> | undefined;
    const hintsDeclared =
      typeof annotations === 'object' &&
      annotations !== null &&
      requiredAnnotationHints.every((hint) => typeof annotations[hint] === 'boolean');

    if (!hintsDeclared) {
      violations.push({ capability, reason: 'missing-annotations' });
      continue;
    }

    if (annotations.readOnlyHint === true && annotations.destructiveHint === true) {
      violations.push({ capability, reason: 'contradictory-annotations' });
    }

    // Every tool in this release is read-only. A write-capable tool is a
    // deliberate future decision with its own approval-flow work, so it fails
    // the gate here rather than shipping unnoticed.
    if (annotations.readOnlyHint !== true) {
      violations.push({ capability, reason: 'write-capable-tool' });
    }
  }

  return violations;
}
