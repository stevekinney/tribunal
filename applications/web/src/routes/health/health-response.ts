export type WebHealthEnvironment = {
  DATABASE_URL?: string;
  REDIS_URL?: string;
};

export type WebHealthDependency = {
  name: 'database' | 'redis';
  ok: boolean;
  detail?: string;
};

export function createWebHealthResponse(environment: WebHealthEnvironment): Response {
  const dependencies: WebHealthDependency[] = [
    {
      name: 'database',
      ok: Boolean(environment.DATABASE_URL),
      ...(!environment.DATABASE_URL && { detail: 'DATABASE_URL is not configured' }),
    },
    {
      name: 'redis',
      ok: Boolean(environment.REDIS_URL),
      ...(!environment.REDIS_URL && { detail: 'REDIS_URL is not configured' }),
    },
  ];
  const ok = dependencies.every((dependency) => dependency.ok);

  return Response.json({ ok, dependencies }, { status: ok ? 200 : 503 });
}
