import { describe, expect, it, vi } from 'vitest';
import { getSupportedScopes, type McpRegistry } from '@lostgradient/mcp';
import { findMetadataContractViolations } from './metadata-contract';
import { tribunalMcpInstructions } from './instructions';
import { tribunalMcpOperations, tribunalMcpRegistry } from './registry';
import { tribunalScopeVocabulary } from './scope-vocabulary';

vi.mock('$env/dynamic/private', () => ({ env: { MCP_SERVER_NAME: 'tribunal-mcp-server' } }));

const grantableScopes = [
  'cost_events:read',
  'pull_requests:read',
  'repositories:read',
  'review_findings:read',
  'reviews:read',
];

describe("Tribunal's MCP registry", () => {
  it('serves exactly the operations the name map declares', () => {
    expect.assertions(2);
    const registryNames = tribunalMcpRegistry.tools.map((tool) => tool.name).sort();

    expect(registryNames).toEqual(Object.keys(tribunalMcpOperations).sort());
    expect(tribunalMcpRegistry.tools).toHaveLength(10);
  });

  it('keys every operation by its own wire name', () => {
    expect.assertions(10);

    for (const [name, tool] of Object.entries(tribunalMcpOperations)) {
      expect(tool.name).toBe(name);
    }
  });

  it("reports Tribunal's own implementation identity rather than the engine's", () => {
    expect.assertions(2);

    expect(tribunalMcpRegistry.serverInfo?.name).toBe('tribunal-mcp-server');
    expect(tribunalMcpRegistry.instructions).toBe(tribunalMcpInstructions);
  });

  it('serves no resources and no prompts in this release', () => {
    expect.assertions(3);

    expect(tribunalMcpRegistry.resources).toEqual([]);
    expect(tribunalMcpRegistry.prompts).toEqual([]);
    expect(tribunalMcpRegistry.conformanceOnlyTools).toBeUndefined();
  });
});

describe('tool annotations', () => {
  it('declares all four safety hints on every tool', () => {
    expect.assertions(40);

    for (const tool of tribunalMcpRegistry.tools) {
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations.idempotentHint).toBe('boolean');
      expect(typeof tool.annotations.openWorldHint).toBe('boolean');
    }
  });

  it('declares every tool read-only and non-destructive', () => {
    expect.assertions(20);

    for (const tool of tribunalMcpRegistry.tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
    }
  });

  it('marks only the GitHub-backed tools as open-world', () => {
    expect.assertions(1);
    const openWorldTools = tribunalMcpRegistry.tools
      .filter((tool) => tool.annotations.openWorldHint)
      .map((tool) => tool.name)
      .sort();

    expect(openWorldTools).toEqual([
      'get_pull_request',
      'get_repository',
      'list_pull_requests',
      'list_repositories',
    ]);
  });
});

describe('scope declarations', () => {
  it('requires a scope from the vocabulary on every tool', () => {
    expect.assertions(10);

    for (const tool of tribunalMcpRegistry.tools) {
      expect(tribunalScopeVocabulary.isScope(tool.requiredScope)).toBe(true);
    }
  });

  it('derives the grantable scope set from the production registry alone', () => {
    expect.assertions(1);

    expect(getSupportedScopes(tribunalMcpRegistry)).toEqual(grantableScopes);
  });

  it('never advertises the reserved conformance scope', () => {
    expect.assertions(2);

    expect(getSupportedScopes(tribunalMcpRegistry)).not.toContain('conformance:read');
    expect(tribunalScopeVocabulary.isScope('conformance:read')).toBe(true);
  });

  it('covers every grantable scope with at least one servable tool', () => {
    expect.assertions(1);
    const declared = new Set(tribunalMcpRegistry.tools.map((tool) => tool.requiredScope));

    expect([...declared].sort()).toEqual(grantableScopes);
  });
});

describe('metadata contract', () => {
  it('backs every advertised capability with a handler', () => {
    expect.assertions(1);

    expect(
      findMetadataContractViolations(tribunalMcpRegistry, {
        isScope: (value) => tribunalScopeVocabulary.isScope(value),
      }),
    ).toEqual([]);
  });

  it('fails when a capability is advertised without a handler', () => {
    expect.assertions(1);
    const [firstTool, ...remainingTools] = tribunalMcpRegistry.tools;
    const brokenRegistry = {
      ...tribunalMcpRegistry,
      tools: [{ ...firstTool, handler: undefined }, ...remainingTools],
    } as unknown as McpRegistry;

    expect(
      findMetadataContractViolations(brokenRegistry, {
        isScope: (value) => tribunalScopeVocabulary.isScope(value),
      }),
    ).toContainEqual({ capability: firstTool.name, reason: 'missing-handler' });
  });

  it.each([
    [
      'a tool requiring a scope outside the vocabulary',
      { requiredScope: 'repositories:write' },
      'undeclared-scope',
    ],
    ['a tool with no annotations at all', { annotations: undefined }, 'missing-annotations'],
    [
      'a tool claiming to be both read-only and destructive',
      {
        annotations: {
          readOnlyHint: true,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      'contradictory-annotations',
    ],
    [
      'a write-capable tool',
      {
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      'write-capable-tool',
    ],
    ['a tool with no description', { description: '  ' }, 'missing-description'],
    ['a tool with no title', { title: '' }, 'missing-title'],
    ['a tool with no name', { name: '' }, 'missing-name'],
  ])('fails on %s', (_label, overrides, reason) => {
    expect.assertions(1);
    const [firstTool, ...remainingTools] = tribunalMcpRegistry.tools;
    const brokenTool = { ...firstTool, ...overrides };
    const brokenRegistry = {
      ...tribunalMcpRegistry,
      tools: [brokenTool, ...remainingTools],
    } as unknown as McpRegistry;

    expect(
      findMetadataContractViolations(brokenRegistry, {
        isScope: (value) => tribunalScopeVocabulary.isScope(value),
      }).map((violation) => violation.reason),
    ).toContain(reason);
  });

  it('fails when two capabilities advertise the same name', () => {
    expect.assertions(1);
    const [firstTool] = tribunalMcpRegistry.tools;
    const brokenRegistry = {
      ...tribunalMcpRegistry,
      tools: [firstTool, firstTool],
    } as unknown as McpRegistry;

    expect(
      findMetadataContractViolations(brokenRegistry, {
        isScope: (value) => tribunalScopeVocabulary.isScope(value),
      }),
    ).toContainEqual({ capability: firstTool.name, reason: 'duplicate-name' });
  });

  it('checks a conformance-only fixture, which is served even though it is never grantable', () => {
    expect.assertions(1);
    const brokenRegistry = {
      ...tribunalMcpRegistry,
      conformanceOnlyTools: [
        {
          name: 'broken_fixture',
          title: 'Broken fixture',
          description: 'Advertised in conformance mode with no handler.',
          inputSchema: undefined,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
          requiredScope: 'conformance:read',
        },
      ],
    } as unknown as McpRegistry;

    // Excluded from `getSupportedScopes()` is a statement about what a client
    // can be granted, not about whether the fixture is well-formed. TRI-30
    // registers one; a fixture with no handler must not pass a gate that
    // claims to check every advertised capability.
    expect(
      findMetadataContractViolations(brokenRegistry, {
        isScope: (value) => tribunalScopeVocabulary.isScope(value),
      }),
    ).toContainEqual({ capability: 'broken_fixture', reason: 'missing-handler' });
  });

  it('checks an advertised prompt too', () => {
    expect.assertions(1);
    const brokenRegistry = {
      ...tribunalMcpRegistry,
      prompts: [
        {
          name: 'broken_prompt',
          title: 'Broken prompt',
          description: 'Advertised with no handler.',
          arguments: undefined,
          requiredScope: 'reviews:read',
        },
      ],
    } as unknown as McpRegistry;

    expect(
      findMetadataContractViolations(brokenRegistry, {
        isScope: (value) => tribunalScopeVocabulary.isScope(value),
      }),
    ).toContainEqual({ capability: 'broken_prompt', reason: 'missing-handler' });
  });

  it('checks resources and prompts, not only tools', () => {
    expect.assertions(1);
    const brokenRegistry = {
      ...tribunalMcpRegistry,
      resources: [
        {
          name: 'broken_resource',
          title: 'Broken resource',
          uri: 'tribunal://broken',
          description: 'Advertised with no handler.',
          mimeType: 'application/json',
          requiredScope: 'repositories:read',
        },
      ],
    } as unknown as McpRegistry;

    expect(
      findMetadataContractViolations(brokenRegistry, {
        isScope: (value) => tribunalScopeVocabulary.isScope(value),
      }),
    ).toContainEqual({ capability: 'broken_resource', reason: 'missing-handler' });
  });
});
