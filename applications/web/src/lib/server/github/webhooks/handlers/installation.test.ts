import { describe, expect, it } from 'vitest';
import { getPrimaryWorkspaceIdForInstallation } from './installation';

describe('getPrimaryWorkspaceIdForInstallation', () => {
  it('always resolves undefined (workspaces were removed from the data model)', async () => {
    await expect(getPrimaryWorkspaceIdForInstallation(42)).resolves.toBeUndefined();
  });
});
