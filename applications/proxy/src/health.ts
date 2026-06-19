export type ProxyHealthDependency = {
  name: 'configuration' | 'credential_resolver' | 'database';
  ok: boolean;
  detail?: string;
};

export type ProxyHealthInput = {
  dependencies?: ProxyHealthDependency[];
};

export function createHealthResponse(input: ProxyHealthInput = {}): Response {
  const dependencies = input.dependencies ?? [
    { name: 'configuration', ok: true },
    { name: 'credential_resolver', ok: true },
  ];
  const ok = dependencies.every((dependency) => dependency.ok);

  return Response.json({ ok, dependencies }, { status: ok ? 200 : 503 });
}
