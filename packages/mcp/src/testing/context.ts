import type { McpContext, McpUserProfile } from '../types/primitives.js';

const defaultTestUser: McpUserProfile = {
  id: 'test-user-00000000-0000-0000-0000-000000000000',
  email: 'test@example.com',
  name: 'Test User',
  image: 'https://example.com/avatar.png',
  role: 'user',
};

export function createTestContext(
  overrides?: Partial<{ userId: string; user: Partial<McpUserProfile> }>,
): McpContext {
  const userId = overrides?.userId ?? defaultTestUser.id;
  return {
    userId,
    user: {
      ...defaultTestUser,
      id: userId,
      ...overrides?.user,
    },
    // `McpContext.signal` is required (a handler that threads it into a
    // cancellable operation must always have one) — a fresh, never-fired
    // controller's signal is a faithful stand-in for "the request is
    // still in flight" in a test that never simulates cancellation.
    signal: new AbortController().signal,
  };
}
