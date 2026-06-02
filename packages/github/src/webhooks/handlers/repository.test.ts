import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GithubServiceContext } from '../../context.js';

// Mock the repositories module
const mockUpdateRepositoryMetadata = vi.fn().mockResolvedValue(undefined);
const mockUpdateRepositoryDefaultBranch = vi.fn().mockResolvedValue(undefined);

vi.mock('../../repositories/service.js', () => ({
  updateRepositoryMetadata: (...args: unknown[]) => mockUpdateRepositoryMetadata(...args),
  updateRepositoryDefaultBranch: (...args: unknown[]) => mockUpdateRepositoryDefaultBranch(...args),
}));

// Mock the validation functions so we control which event type matches
const mockIsRepositoryRenamedEvent = vi.fn().mockReturnValue(false);
const mockIsRepositoryTransferredEvent = vi.fn().mockReturnValue(false);
const mockIsRepositoryEditedEvent = vi.fn().mockReturnValue(false);

vi.mock('../validate-github-webhook.js', () => ({
  isRepositoryRenamedEvent: (...args: unknown[]) => mockIsRepositoryRenamedEvent(...args),
  isRepositoryTransferredEvent: (...args: unknown[]) => mockIsRepositoryTransferredEvent(...args),
  isRepositoryEditedEvent: (...args: unknown[]) => mockIsRepositoryEditedEvent(...args),
}));

// Import after mocking
const { handleRepositoryMetadataEvents } = await import('./repository.js');

// ============================================================================
// Test helpers
// ============================================================================

function createMockContext(overrides?: Partial<GithubServiceContext>): GithubServiceContext {
  return {
    db: {} as any,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function makeRepositoryPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'edited',
    repository: {
      id: 12345,
      owner: { login: 'acme' },
      name: 'widgets',
      full_name: 'acme/widgets',
      default_branch: 'main',
    },
    installation: { id: 999 },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('handleRepositoryMetadataEvents', () => {
  let context: GithubServiceContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsRepositoryRenamedEvent.mockReturnValue(false);
    mockIsRepositoryTransferredEvent.mockReturnValue(false);
    mockIsRepositoryEditedEvent.mockReturnValue(false);
    context = createMockContext();
  });

  // --------------------------------------------------------------------------
  // repository.edited -- default branch changes
  // --------------------------------------------------------------------------
  describe('repository.edited (default branch)', () => {
    it('updates default branch when it actually changed', async () => {
      mockIsRepositoryEditedEvent.mockReturnValue(true);
      const data = makeRepositoryPayload({
        changes: {
          default_branch: { from: 'master' },
        },
      });

      await handleRepositoryMetadataEvents(context, data);

      expect(mockUpdateRepositoryDefaultBranch).toHaveBeenCalledWith(context, 12345, 'main');
    });

    it('does not update when changes.default_branch is absent', async () => {
      mockIsRepositoryEditedEvent.mockReturnValue(true);
      const data = makeRepositoryPayload({
        changes: {
          description: { from: 'old description' },
        },
      });

      await handleRepositoryMetadataEvents(context, data);

      expect(mockUpdateRepositoryDefaultBranch).not.toHaveBeenCalled();
    });

    it('does not update when old and new branch names are the same', async () => {
      mockIsRepositoryEditedEvent.mockReturnValue(true);
      const data = makeRepositoryPayload({
        changes: {
          default_branch: { from: 'main' }, // same as repository.default_branch
        },
      });

      await handleRepositoryMetadataEvents(context, data);

      expect(mockUpdateRepositoryDefaultBranch).not.toHaveBeenCalled();
    });

    it('logs error and does not throw when database update fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockIsRepositoryEditedEvent.mockReturnValue(true);
      const dbError = new Error('Database connection failed');
      mockUpdateRepositoryDefaultBranch.mockRejectedValueOnce(dbError);

      const data = makeRepositoryPayload({
        changes: {
          default_branch: { from: 'develop' },
        },
      });

      // Should not throw
      await handleRepositoryMetadataEvents(context, data);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to update repository default branch:',
        dbError,
      );

      consoleErrorSpy.mockRestore();
    });

    it('calls updateRepositoryDefaultBranch which resets commit to null', async () => {
      mockIsRepositoryEditedEvent.mockReturnValue(true);
      const data = makeRepositoryPayload({
        changes: {
          default_branch: { from: 'develop' },
        },
      });

      await handleRepositoryMetadataEvents(context, data);

      // updateRepositoryDefaultBranch is responsible for resetting commit to null
      expect(mockUpdateRepositoryDefaultBranch).toHaveBeenCalledTimes(1);
      expect(mockUpdateRepositoryDefaultBranch).toHaveBeenCalledWith(context, 12345, 'main');
    });
  });

  // --------------------------------------------------------------------------
  // repository.renamed
  // --------------------------------------------------------------------------
  describe('repository.renamed', () => {
    it('updates repository metadata on rename', async () => {
      mockIsRepositoryRenamedEvent.mockReturnValue(true);
      const data = makeRepositoryPayload({ action: 'renamed' });

      await handleRepositoryMetadataEvents(context, data);

      expect(mockUpdateRepositoryMetadata).toHaveBeenCalledWith(
        context,
        12345,
        'acme',
        'widgets',
        999,
      );
    });
  });

  // --------------------------------------------------------------------------
  // repository.transferred
  // --------------------------------------------------------------------------
  describe('repository.transferred', () => {
    it('updates repository metadata on transfer', async () => {
      mockIsRepositoryTransferredEvent.mockReturnValue(true);
      const data = makeRepositoryPayload({ action: 'transferred' });

      await handleRepositoryMetadataEvents(context, data);

      expect(mockUpdateRepositoryMetadata).toHaveBeenCalledWith(
        context,
        12345,
        'acme',
        'widgets',
        999,
      );
    });
  });
});
