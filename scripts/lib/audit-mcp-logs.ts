export type McpLogAuditFinding = { file: string; message: string };

const secretIdentifierPattern =
  /\$\{[^}]*(?:authorization|cookie|token|codeVerifier|codeChallenge|clientSecret|password|state|email|databaseUrl|redisUrl)[^}]*\}/i;
const credentialValuePattern =
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*|(?:postgres(?:ql)?|rediss?):\/\/[^:@/\s"']+:[^@/\s"']+@/i;

/** Audits source text for unsafe OAuth/MCP operational logging. */
export function auditMcpLogSource(source: string, file: string): McpLogAuditFinding[] {
  const findings: McpLogAuditFinding[] = [];
  for (const match of source.matchAll(/logger\.(?:debug|info|warn|error)\(([^;]+)\)/gs)) {
    const call = match[0];
    if (secretIdentifierPattern.test(call) || credentialValuePattern.test(call)) {
      findings.push({
        file,
        message: 'Credential-shaped value is interpolated into a log message.',
      });
      continue;
    }
    if (
      /['"`]\s*(?:MCP|OAuth)/i.test(call) &&
      (!/\bevent\s*:/.test(call) || !/\boutcome\s*:/.test(call))
    ) {
      findings.push({
        file,
        message: 'MCP and OAuth log records require event and outcome fields.',
      });
    }
  }
  return findings;
}
