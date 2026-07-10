/**
 * `repository_event_listener.filters_json` is deliberately boring: exact
 * matching against a fixed set of fields already normalized onto
 * `webhook_event`. No JSONPath, no user-authored expressions. Adding a new
 * filterable field means adding a named key here (and a matching branch in
 * the matcher), never accepting an arbitrary path or predicate string.
 */
export interface EventListenerFilters {
  ref?: string;
  prNumber?: number;
  issueNumber?: number;
  senderLogin?: string;
}

const SUPPORTED_FILTER_KEYS = new Set<keyof EventListenerFilters>([
  'ref',
  'prNumber',
  'issueNumber',
  'senderLogin',
]);

export class InvalidEventListenerFiltersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventListenerFiltersError';
  }
}

/**
 * Validate an untrusted filters object (from a form submission or API body)
 * against the supported named fields and serialize it for storage.
 * Throws `InvalidEventListenerFiltersError` on any unsupported key or
 * mistyped value rather than silently dropping or coercing it.
 */
export function serializeEventListenerFilters(filters: unknown): string {
  if (filters === null || filters === undefined) {
    return '{}';
  }

  if (typeof filters !== 'object' || Array.isArray(filters)) {
    throw new InvalidEventListenerFiltersError('Event listener filters must be a plain object');
  }

  const result: EventListenerFilters = {};

  for (const [rawKey, value] of Object.entries(filters as Record<string, unknown>)) {
    if (!SUPPORTED_FILTER_KEYS.has(rawKey as keyof EventListenerFilters)) {
      throw new InvalidEventListenerFiltersError(`Unsupported event listener filter: ${rawKey}`);
    }

    if (value === undefined || value === null) continue;

    const key = rawKey as keyof EventListenerFilters;

    if (key === 'prNumber' || key === 'issueNumber') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new InvalidEventListenerFiltersError(`Filter "${key}" must be an integer`);
      }
      result[key] = value;
    } else {
      if (typeof value !== 'string' || value.length === 0) {
        throw new InvalidEventListenerFiltersError(`Filter "${key}" must be a non-empty string`);
      }
      result[key] = value;
    }
  }

  return JSON.stringify(result);
}

/**
 * Parse a stored `filters_json` value back into a typed filters object.
 *
 * Returns `null` for unparseable/malformed JSON (should not happen given
 * `serializeEventListenerFilters` is the only writer, but a corrupt row is
 * a real possibility over time) -- callers must treat `null` as "fail
 * closed" (the listener does not match anything) rather than "no filters"
 * (which matches everything of that event type/action). Silently widening
 * a listener's match scope because its stored filters became unreadable
 * would be an unsafe default; refusing to match is the safe one.
 */
export function parseEventListenerFilters(filtersJson: string): EventListenerFilters | null {
  try {
    const parsed: unknown = JSON.parse(filtersJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const parsedRecord = parsed as Record<string, unknown>;

    // Any key outside the supported set (or a value of the wrong shape for
    // a supported key) means this row is corrupt or was written by code
    // this parser doesn't understand -- fail closed by returning null
    // rather than silently dropping the unknown key and returning `{}`,
    // which the matcher treats as "no filters" (matches everything).
    for (const [key, value] of Object.entries(parsedRecord)) {
      if (value === undefined || value === null) continue;
      if (!SUPPORTED_FILTER_KEYS.has(key as keyof EventListenerFilters)) {
        return null;
      }
      if (key === 'prNumber' || key === 'issueNumber') {
        if (typeof value !== 'number' || !Number.isInteger(value)) return null;
      } else if (typeof value !== 'string' || value.length === 0) {
        return null;
      }
    }

    const result: EventListenerFilters = {};
    for (const key of SUPPORTED_FILTER_KEYS) {
      const value = parsedRecord[key];
      if (value === undefined || value === null) continue;
      if (key === 'prNumber' || key === 'issueNumber') {
        result[key] = value as number;
      } else {
        result[key] = value as string;
      }
    }
    return result;
  } catch {
    return null;
  }
}
