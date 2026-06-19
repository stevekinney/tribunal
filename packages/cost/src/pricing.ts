export type SandboxRuntime = {
  runtimeSeconds: number;
  storageSeconds?: number;
};

export type SandboxResources = {
  cpus: number;
  memoryMb: number;
  storageMb: number;
};

export type SandboxPricing = {
  cpuSecondUsd: number;
  memoryGbSecondUsd: number;
  storageGbSecondUsd: number;
};

export const PRICING = {
  '2026-06-17': {
    sandbox: {
      cpuSecondUsd: 0.000011,
      memoryGbSecondUsd: 0.000004,
      storageGbSecondUsd: 0.00000002,
    },
  },
} as const satisfies Record<string, { sandbox: SandboxPricing }>;

export const CURRENT_PRICING_VERSION = '2026-06-17' satisfies keyof typeof PRICING;

function dollars(value: number): number {
  return Number(value.toFixed(8));
}

/**
 * Estimates sandbox spend from runtime and allocated resources.
 */
export function sandboxCost(
  runtime: SandboxRuntime,
  resources: SandboxResources,
  pricing: SandboxPricing = PRICING[CURRENT_PRICING_VERSION].sandbox,
): number {
  const memoryGb = resources.memoryMb / 1024;
  const storageGb = resources.storageMb / 1024;
  const storageSeconds = runtime.storageSeconds ?? runtime.runtimeSeconds;

  return dollars(
    runtime.runtimeSeconds * resources.cpus * pricing.cpuSecondUsd +
      runtime.runtimeSeconds * memoryGb * pricing.memoryGbSecondUsd +
      storageSeconds * storageGb * pricing.storageGbSecondUsd,
  );
}
