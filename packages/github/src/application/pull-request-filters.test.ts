import { describe, expect, it } from 'vitest';

import { DEFAULT_PROJECT_PR_FILTERS } from './pull-request-filters.js';

describe('DEFAULT_PROJECT_PR_FILTERS', () => {
  it('uses the shared open pull request aggregation defaults', () => {
    expect.assertions(1);

    expect(DEFAULT_PROJECT_PR_FILTERS).toEqual({
      state: 'open',
      sort: 'updated',
      direction: 'desc',
      perPage: 30,
      maxTotal: 100,
    });
  });
});
