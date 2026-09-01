import { z } from 'zod';

/** The page size a caller gets when it asks for none. */
export const defaultPageSize = 25;
/** The largest page any list tool will return, whatever the caller asks for. */
export const maximumPageSize = 100;

/**
 * Every list tool paginates, and every list tool paginates the same way.
 *
 * The alternative — an unconditional `LIMIT 50` with no cursor, which is what
 * Tribunal's own operator readers do — is the worst failure shape available to
 * a list tool: the client cannot distinguish truncation from absence, so a
 * model asking "which reviews failed?" silently reasons over a prefix of the
 * answer. `hasMore` on every page is what makes that visible.
 */
export const paginationInputFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(maximumPageSize)
    .default(defaultPageSize)
    .describe(`Maximum rows to return. Between 1 and ${maximumPageSize}.`),
  offset: z.number().int().min(0).default(0).describe('Rows to skip before the first result.'),
};

export type PaginationInput = {
  limit: number;
  offset: number;
};

export type Page<Item> = {
  items: Item[];
  limit: number;
  offset: number;
  /** True when rows exist past this page, so a client can tell short from last. */
  hasMore: boolean;
};

/**
 * Turns an over-fetched row set into a page.
 *
 * Readers query `limit + 1` rows; the extra row is never returned, it only
 * answers whether another page exists. Counting separately would need a second
 * query against a moving table and could disagree with the rows just read.
 */
export function buildPage<Item>(rows: Item[], { limit, offset }: PaginationInput): Page<Item> {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, limit, offset, hasMore };
}

/**
 * Pages a set that was resolved in full before it could be paged.
 *
 * The repository list is the case: it comes from GitHub's own installation
 * endpoints through the caller's token, so there is no query to push `LIMIT`
 * into — the whole set is already in memory by the time a page can be cut from
 * it. Paging it anyway keeps every list tool honest about the same contract,
 * which the server instructions state without exception, and gives a client
 * with a large account a bounded response.
 */
export function paginateResolvedItems<Item>(
  items: readonly Item[],
  { limit, offset }: PaginationInput,
): Page<Item> {
  return {
    items: items.slice(offset, offset + limit),
    limit,
    offset,
    hasMore: items.length > offset + limit,
  };
}
