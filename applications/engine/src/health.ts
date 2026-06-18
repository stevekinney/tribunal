export type EngineHealthDependency = {
  name: 'weft_database' | 'singleton_lock';
  ok: boolean;
  detail?: string;
};

export type EngineHealthInput = {
  dependencies?: EngineHealthDependency[];
};

export function createHealthResponse(input: EngineHealthInput = {}): Response {
  const dependencies = input.dependencies ?? [
    { name: 'weft_database', ok: true },
    { name: 'singleton_lock', ok: true },
  ];
  const ok = dependencies.every((dependency) => dependency.ok);

  return Response.json({ ok, dependencies }, { status: ok ? 200 : 503 });
}
