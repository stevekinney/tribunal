import { parseProxyEnvironment } from './environment';
import { createProxyHandler } from './proxy';

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

if (import.meta.main) {
  const port = parsePort(Bun.env.PORT, 3002);
  const environment = parseProxyEnvironment(Bun.env);
  const proxyHandler = createProxyHandler({ environment });

  Bun.serve({
    port,
    fetch: proxyHandler,
  });
}
