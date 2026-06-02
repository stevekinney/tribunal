import { describe, it, expect, vi } from 'vitest';
import { createTabs } from './create-tabs';

// Mock the resolve function from $app/paths
vi.mock('$app/paths', () => ({
  resolve: vi.fn((route: string, parameters?: Record<string, string>): string => {
    let result = route;
    if (parameters) {
      for (const [key, value] of Object.entries(parameters)) {
        // Handle both [key] and [key=matcher] patterns
        result = result.replace(new RegExp(`\\[${key}(?:=[^\\]]+)?\\]`, 'g'), value);
      }
    }
    // Remove route groups like (authenticated)
    return result.replace(/\([^)]+\)\/?/g, '');
  }),
}));

describe('createTabs', () => {
  describe('basic tab generation', () => {
    it('creates tabs with correct labels', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings' }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs).toHaveLength(2);
      expect(tabs[0].label).toBe('Overview');
      expect(tabs[1].label).toBe('Settings');
    });

    it('generates correct paths for tabs', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings' }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs[0].path).toBe('/workspaces/test-workspace/projects/test-project');
      expect(tabs[1].path).toBe('/workspaces/test-workspace/projects/test-project/settings');
    });
  });

  describe('active tab detection', () => {
    it('marks base path tab as active when on root', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings' }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs[0].active).toBe(true);
      expect(tabs[1].active).toBe(false);
    });

    it('marks settings tab as active when on settings path', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project/settings',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings' }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs[0].active).toBe(false);
      expect(tabs[1].active).toBe(true);
    });

    it('marks tab as active for nested paths', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project/settings/advanced',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings' }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs[0].active).toBe(false);
      expect(tabs[1].active).toBe(true);
    });
  });

  describe('conditional tab visibility', () => {
    it('filters out tabs when show is false', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings', show: false }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs).toHaveLength(1);
      expect(tabs[0].label).toBe('Overview');
    });

    it('includes tabs when show is true', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings', show: true }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs).toHaveLength(2);
    });

    it('includes tabs when show is undefined', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings' }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs).toHaveLength(2);
    });

    it('evaluates function for show property', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings', show: () => false }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs).toHaveLength(1);
      expect(tabs[0].label).toBe('Overview');
    });

    it('shows tab when show function returns true', () => {
      const canModify = true;
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/test-workspace/projects/test-project',
        [{ label: 'Overview' }, { label: 'Settings', path: 'settings', show: () => canModify }],
        { workspace: 'test-workspace', project: 'test-project' },
      );

      expect(tabs).toHaveLength(2);
    });
  });

  describe('workspace layout tabs', () => {
    it('creates workspace tabs correctly', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]',
        '/workspaces/my-workspace',
        [
          { label: 'Overview' },
          { label: 'Projects', path: 'projects' },
          { label: 'Members', path: 'members' },
          { label: 'Settings', path: 'settings', show: true },
        ],
        { workspace: 'my-workspace' },
      );

      expect(tabs).toHaveLength(4);
      expect(tabs.map((t) => t.label)).toEqual(['Overview', 'Projects', 'Members', 'Settings']);
    });

    it('marks projects tab as active when viewing projects', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]',
        '/workspaces/my-workspace/projects',
        [
          { label: 'Overview' },
          { label: 'Projects', path: 'projects' },
          { label: 'Members', path: 'members' },
        ],
        { workspace: 'my-workspace' },
      );

      expect(tabs[0].active).toBe(false);
      expect(tabs[1].active).toBe(true);
      expect(tabs[2].active).toBe(false);
    });
  });

  describe('parameter substitution', () => {
    it('handles different workspace handles', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/another-ws/projects/some-project',
        [{ label: 'Overview' }],
        { workspace: 'another-ws', project: 'some-project' },
      );

      expect(tabs[0].path).toBe('/workspaces/another-ws/projects/some-project');
    });

    it('handles special characters in handles', () => {
      const tabs = createTabs(
        '/(authenticated)/workspaces/[workspace=slug]/projects/[project=slug]',
        '/workspaces/my-workspace-123/projects/project-with-dashes',
        [{ label: 'Overview' }],
        { workspace: 'my-workspace-123', project: 'project-with-dashes' },
      );

      expect(tabs[0].path).toBe('/workspaces/my-workspace-123/projects/project-with-dashes');
    });
  });
});
