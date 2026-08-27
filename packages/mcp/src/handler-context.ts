import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

type NotificationSender = (notification: {
  method: string;
  params: Record<string, unknown>;
}) => Promise<void>;

type RequestSender = (request: {
  method: string;
  params: Record<string, unknown>;
}) => Promise<unknown>;

function readMcpReq(ctx: unknown): Record<string, unknown> | undefined {
  if (!ctx || typeof ctx !== 'object') return undefined;
  const mcpReq = (ctx as { mcpReq?: unknown }).mcpReq;
  if (!mcpReq || typeof mcpReq !== 'object') return undefined;
  return mcpReq as Record<string, unknown>;
}

export function readProgressToken(ctx: unknown): string | number | undefined {
  const mcpReq = readMcpReq(ctx);
  const meta = mcpReq?._meta as { progressToken?: string | number } | undefined;
  return meta?.progressToken;
}

export function readSessionIdentifier(ctx: unknown): string | undefined {
  if (!ctx || typeof ctx !== 'object') return undefined;
  return (ctx as { sessionId?: string }).sessionId;
}

export function readNotificationSender(ctx: unknown): NotificationSender | undefined {
  const mcpReq = readMcpReq(ctx);
  const notify = mcpReq?.notify;
  if (typeof notify !== 'function') return undefined;
  return notify as NotificationSender;
}

export function readRequestSender(ctx: unknown): RequestSender | undefined {
  const mcpReq = readMcpReq(ctx);
  const send = mcpReq?.send;
  if (typeof send !== 'function') return undefined;
  return send as RequestSender;
}

export function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseSampledText(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0] as { text?: unknown };
    if (typeof first?.text === 'string') {
      return first.text;
    }
  }
  if (content && typeof content === 'object') {
    const text = (content as { text?: unknown }).text;
    if (typeof text === 'string') {
      return text;
    }
  }
  return stringifyUnknown(result);
}

export function assertSamplingSupport(ctx: unknown): void {
  const requestSender = readRequestSender(ctx);
  if (!requestSender) {
    throw new ProtocolError(ProtocolErrorCode.InvalidRequest, 'Client does not support sampling');
  }
}
