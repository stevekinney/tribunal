import { describe, expect, it } from 'vitest';
import { auditMcpLogSource } from './audit-mcp-logs';

describe('auditMcpLogSource', () => {
  it('rejects credential-shaped interpolation in a log message', () => {
    expect(auditMcpLogSource('logger.info(`token ${accessToken}`)', 'fixture.ts')).toHaveLength(1);
  });

  it('rejects a literal credential-shaped log value', () => {
    expect(
      auditMcpLogSource(
        "logger.error('connection postgres://operator:secret@database.example/tribunal')",
        'fixture.ts',
      ),
    ).toHaveLength(1);
  });

  it('rejects MCP and OAuth records without event and outcome', () => {
    expect(
      auditMcpLogSource("logger.info({ requestId }, 'MCP request')", 'fixture.ts'),
    ).toHaveLength(1);
  });

  it('accepts structured operational records without secret values', () => {
    expect(
      auditMcpLogSource(
        "logger.info({ event: 'mcp_request', outcome: 'success', requestId }, 'MCP request')",
        'fixture.ts',
      ),
    ).toEqual([]);
  });
});
