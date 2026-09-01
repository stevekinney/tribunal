import { describe, expect, it } from 'vitest';
import { buildPage, defaultPageSize, maximumPageSize, paginationInputFields } from './pagination';

describe('buildPage', () => {
  it('reports hasMore and drops the over-fetched row when a further page exists', () => {
    expect.assertions(2);
    const page = buildPage([1, 2, 3], { limit: 2, offset: 0 });

    expect(page.items).toEqual([1, 2]);
    expect(page.hasMore).toBe(true);
  });

  it('reports the last page as complete when the reader returned no extra row', () => {
    expect.assertions(2);
    const page = buildPage([1, 2], { limit: 2, offset: 4 });

    expect(page.items).toEqual([1, 2]);
    expect(page.hasMore).toBe(false);
  });

  it('carries the requested window back to the caller', () => {
    expect.assertions(2);
    const page = buildPage<number>([], { limit: 10, offset: 30 });

    expect(page.limit).toBe(10);
    expect(page.offset).toBe(30);
  });
});

describe('paginationInputFields', () => {
  it('defaults an omitted window to the default page size at offset zero', () => {
    expect.assertions(2);

    expect(paginationInputFields.limit.parse(undefined)).toBe(defaultPageSize);
    expect(paginationInputFields.offset.parse(undefined)).toBe(0);
  });

  it('refuses a page larger than the maximum', () => {
    expect.assertions(1);

    expect(() => paginationInputFields.limit.parse(maximumPageSize + 1)).toThrow();
  });

  it('refuses a negative offset', () => {
    expect.assertions(1);

    expect(() => paginationInputFields.offset.parse(-1)).toThrow();
  });
});
