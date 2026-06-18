import { createHealthResponse } from './health';

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

if (import.meta.main) {
  const port = parsePort(Bun.env.PORT, 3001);

  Bun.serve({
    port,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/health') {
        return createHealthResponse();
      }
      return new Response('Not found', { status: 404 });
    },
  });
}
