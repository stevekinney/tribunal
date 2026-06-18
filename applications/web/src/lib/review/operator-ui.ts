const xhighEligibleModels = new Set(['opus', 'fable']);

export function getEffortFallbackNotice(model: string, effort: string | null | undefined) {
  if (effort !== 'xhigh') return null;
  if (xhighEligibleModels.has(model)) return null;
  return 'xhigh will be stored, but this model falls back to high effort at runtime.';
}
