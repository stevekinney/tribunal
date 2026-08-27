import { afterEach, describe, expect, it } from 'vitest';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { hasRegisteredUiExtensionResource } from './ui-extension-support.js';
import { allResources } from './resources/index.js';
import type { McpResourceDefinition } from './types/primitives.js';

afterEach(() => {
  allResources.length = 0;
});

describe('hasRegisteredUiExtensionResource', () => {
  it('is false when no resource is registered at all', () => {
    expect(hasRegisteredUiExtensionResource()).toBe(false);
  });

  it('is false when a registered resource has an ordinary MIME type', () => {
    const ordinaryResource: McpResourceDefinition = {
      name: 'ordinary_resource',
      title: 'Ordinary resource',
      uri: 'test://ordinary',
      description: 'An ordinary, non-MCP-App resource.',
      mimeType: 'text/plain',
      requiredScope: 'profile:read',
      handler: async (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: 'text/plain', text: 'ordinary' }],
      }),
    };
    allResources.push(ordinaryResource);

    expect(hasRegisteredUiExtensionResource()).toBe(false);
  });

  it('is true when a registered resource carries the MCP Apps MIME type', () => {
    const appResource: McpResourceDefinition = {
      name: 'ui_app_resource',
      title: 'UI app resource',
      uri: 'ui://app',
      description: 'An MCP App resource.',
      mimeType: RESOURCE_MIME_TYPE,
      requiredScope: 'profile:read',
      handler: async (uri) => ({
        contents: [{ uri: uri.toString(), mimeType: RESOURCE_MIME_TYPE, text: '<html></html>' }],
      }),
    };
    allResources.push(appResource);

    expect(hasRegisteredUiExtensionResource()).toBe(true);
  });
});
