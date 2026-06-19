const xhighEligibleModels = new Set(['opus', 'fable']);

function normalizeModelFamily(model: string): string {
  const concreteModelMatch = /^claude-(opus|fable|sonnet|haiku)(?:-|$)/.exec(model);
  return concreteModelMatch?.[1] ?? model;
}

export function getEffortFallbackNotice(model: string, effort: string | null | undefined) {
  if (effort !== 'xhigh') return null;
  if (xhighEligibleModels.has(normalizeModelFamily(model))) return null;
  return 'xhigh will be stored, but this model falls back to high effort at runtime.';
}
