export type WebHealthEnvironment = {
  DATABASE_URL?: string;
  REDIS_URL?: string;
};

export type WebHealthDependency = {
  name: 'database' | 'redis';
  ok: boolean;
  detail?: string;
};

export type WebHealthProbe = {
  database?: () => Promise<void>;
  redis?: () => Promise<void>;
};

export async function createWebHealthResponse(
  environment: WebHealthEnvironment,
  probe: WebHealthProbe = {},
): Promise<Response> {
  const dependencies: WebHealthDependency[] = [
    await checkDatabaseDependency(environment, probe),
    await checkRedisDependency(environment, probe),
  ];
  const ok = dependencies.every((dependency) => dependency.ok);

  return Response.json({ ok, dependencies }, { status: ok ? 200 : 503 });
}

async function checkRedisDependency(
  environment: WebHealthEnvironment,
  probe: WebHealthProbe,
): Promise<WebHealthDependency> {
  if (!environment.REDIS_URL) {
    return { name: 'redis', ok: false, detail: 'REDIS_URL is not configured' };
  }
  if (probe.redis === undefined) return { name: 'redis', ok: true };
  try {
    await probe.redis();
    return { name: 'redis', ok: true };
  } catch (error) {
    return {
      name: 'redis',
      ok: false,
      detail: error instanceof Error ? error.message : 'Redis probe failed',
    };
  }
}

async function checkDatabaseDependency(
  environment: WebHealthEnvironment,
  probe: WebHealthProbe,
): Promise<WebHealthDependency> {
  if (!environment.DATABASE_URL) {
    return { name: 'database', ok: false, detail: 'DATABASE_URL is not configured' };
  }
  if (probe.database === undefined) return { name: 'database', ok: true };
  try {
    await probe.database();
    return { name: 'database', ok: true };
  } catch (error) {
    return {
      name: 'database',
      ok: false,
      detail: error instanceof Error ? error.message : 'database probe failed',
    };
  }
}
