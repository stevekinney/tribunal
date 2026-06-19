const REDACTED_VALUE = '[REDACTED]';
const REDACTED_CONTENT = '[REDACTED_CONTENT]';

const secretTextPatterns = [
  /\bsk-ant-[A-Za-z0-9_-]+\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]+\b/gu,
  /\bgh[opsru]_[A-Za-z0-9_]+\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
];

const sensitiveKeyPattern = /(?:authorization|credential|api[_-]?key|token|secret|password)/iu;
const rawContentKeyPattern = /^(?:content|contents|fileContent|rawFileContent)$/iu;

export function redactRuntimeText(value: string): string {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]');

  for (const pattern of secretTextPatterns) {
    redacted = redacted.replace(pattern, REDACTED_VALUE);
  }

  return redacted;
}

export function redactRuntimeValue(value: unknown): unknown {
  return redactRuntimeValueForKey('', value);
}

export function redactRuntimeRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactRuntimeValue(value) as Record<string, unknown>;
}

function redactRuntimeValueForKey(key: string, value: unknown): unknown {
  if (sensitiveKeyPattern.test(key)) return REDACTED_VALUE;
  if (rawContentKeyPattern.test(key)) return REDACTED_CONTENT;

  if (typeof value === 'string') return redactRuntimeText(value);
  if (Array.isArray(value)) return value.map((entry) => redactRuntimeValueForKey(key, entry));
  if (!isRecord(value)) return value;

  const redacted: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    redacted[entryKey] = redactRuntimeValueForKey(entryKey, entryValue);
  }
  return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
