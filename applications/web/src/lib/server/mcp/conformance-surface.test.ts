import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/oauth/configuration', () => ({ isMcpConformanceMode: vi.fn() }));
vi.mock('$lib/server/auth/dev-auth-bypass-flag', () => ({ isDevAuthBypassEnabled: vi.fn() }));

import { isMcpConformanceMode } from '$lib/server/oauth/configuration';
import { isDevAuthBypassEnabled } from '$lib/server/auth/dev-auth-bypass-flag';
import { conformanceSurfaceEnabled } from './conformance-surface';

describe('conformanceSurfaceEnabled (TRI-45 AC3)', () => {
  beforeEach(() => {
    vi.mocked(isMcpConformanceMode).mockReset();
    vi.mocked(isDevAuthBypassEnabled).mockReset();
  });

  it('is enabled when conformance mode is on and the dev auth bypass is not armed', () => {
    vi.mocked(isMcpConformanceMode).mockReturnValue(true);
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(false);
    expect(conformanceSurfaceEnabled()).toBe(true);
  });

  it('is disabled when the dev auth bypass is armed, even with conformance mode on', () => {
    vi.mocked(isMcpConformanceMode).mockReturnValue(true);
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(true);
    expect(conformanceSurfaceEnabled()).toBe(false);
  });

  it('is disabled when conformance mode is off regardless of the bypass', () => {
    vi.mocked(isMcpConformanceMode).mockReturnValue(false);
    vi.mocked(isDevAuthBypassEnabled).mockReturnValue(false);
    expect(conformanceSurfaceEnabled()).toBe(false);
  });
});
