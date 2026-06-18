import { z } from 'zod';

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/);
const positiveDecimalString = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const booleanFlag = z.enum(['true', 'false', '1', '0']).transform((value) => {
  return value === 'true' || value === '1';
});

export const engineEnvironmentSchema = z.object({
  WEFT_DATABASE_URL: z.string().url(),
  TENSORLAKE_API_KEY: z.string().min(1),
  TRIBUNAL_SANDBOX_IMAGE: z.string().min(1),
  PROXY_SIGNING_KEY: z.string().min(1),
  TRIBUNAL_ENGINE_CONTROL_TOKEN: z.string().min(1),
  TRIBUNAL_DEFAULT_MODEL: z.string().min(1),
  MAX_CONCURRENT_AGENTS: positiveIntegerString.transform(Number),
  PER_AGENT_BUDGET_USD: positiveDecimalString.transform(Number),
  DEFAULT_DAILY_COST_CAP_USD: positiveDecimalString.transform(Number),
  IDLE_SUSPEND_SECONDS: positiveIntegerString.transform(Number),
  SANDBOX_REAP_INTERVAL: positiveIntegerString.transform(Number),
  ENABLE_PROMPT_CACHING_1H: booleanFlag,
  ANTHROPIC_ADMIN_KEY: z.string().min(1),
  WEFT_INSPECTOR: booleanFlag.default(false),
});

export type EngineEnvironment = z.infer<typeof engineEnvironmentSchema>;

export function parseEngineEnvironment(
  environment: Record<string, string | undefined>,
): EngineEnvironment {
  return engineEnvironmentSchema.parse(environment);
}
