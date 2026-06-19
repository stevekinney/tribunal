export type ProxyAuditService = 'github' | 'anthropic' | 'proxy';

export type ProxyAuditOutcome = 'forwarded' | 'blocked' | 'rejected';

export type ProxyAuditEvent = {
  type: 'proxy_audit_event';
  timestamp: string;
  service: ProxyAuditService;
  outcome: ProxyAuditOutcome;
  status: number;
  method: string;
  runId?: string;
  userId?: number;
  repositoryId?: number;
  repository?: string;
  upstreamHost?: string;
  upstreamPath?: string;
  reason?: string;
  credentialInjected?: boolean;
};

export type AuditSink = (event: ProxyAuditEvent) => void | Promise<void>;

const commonSecretPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu,
  /\bgh[oprsu]_[A-Za-z0-9_]+\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]+\b/gu,
  /\bsk-ant-[A-Za-z0-9_-]+\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]+\b/gu,
];

export function redactAuditValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return redactString(value, secrets);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactAuditValue(entry, secrets));
  }

  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      redacted[key] = redactAuditValue(entry, secrets);
    }
    return redacted;
  }

  return value;
}

export function redactAuditEvent(
  event: ProxyAuditEvent,
  secrets: readonly string[],
): ProxyAuditEvent {
  return redactAuditValue(event, secrets) as ProxyAuditEvent;
}

export function createConsoleAuditSink(): AuditSink {
  return (event) => {
    console.info(JSON.stringify(event));
  };
}

function redactString(value: string, secrets: readonly string[]): string {
  let redacted = value;

  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join('[REDACTED]');
    }
  }

  for (const pattern of commonSecretPatterns) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }

  return redacted;
}
