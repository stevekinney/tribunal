import { z } from 'zod';

const positiveIntegerString = z.string().regex(/^[1-9]\d*$/);
const nonNegativeIntegerString = z.string().regex(/^(?:0|[1-9]\d*)$/);
const positiveDecimalString = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
  }, 'must be a finite number greater than zero');
const booleanFlag = z.enum(['true', 'false', '1', '0']).transform((value) => {
  return value === 'true' || value === '1';
});
const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

export const engineEnvironmentSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    WEFT_DATABASE_URL: z.string().url().optional(),
    // Optional direct (unpooled) Neon connection used ONLY for the singleton
    // advisory lock in postgres-advisory-lock.ts. Session-level advisory locks
    // are unsound over a PgBouncer transaction-pooled endpoint (the default for
    // WEFT_DATABASE_URL) — see that file's header comment. Falls back to
    // WEFT_DATABASE_URL when unset so this ships safely before the operator
    // provisions the secret; must stay optional or a missing secret would
    // crash-loop production.
    ENGINE_SINGLETON_DATABASE_URL: z.string().url().optional(),
    GITHUB_APP_ID: z.string().min(1),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1),
    TENSORLAKE_API_KEY: z.string().min(1),
    TRIBUNAL_SANDBOX_IMAGE: z.string().min(1),
    TRIBUNAL_PROXY_URL: z.string().url(),
    TRIBUNAL_PROXY_CIDR: z.string().min(1),
    PROXY_SIGNING_KEY: z.string().min(1),
    ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
    TRIBUNAL_ENGINE_CONTROL_TOKEN: z.string().min(1),
    TRIBUNAL_ENGINE_BIND_HOST: optionalNonEmptyString,
    TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE: booleanFlag.default(false),
    TRIBUNAL_DEFAULT_MODEL: z.string().min(1),
    DEFAULT_DAILY_COST_CAP_USD: positiveDecimalString.transform(Number),
    IDLE_SUSPEND_SECONDS: positiveIntegerString.transform(Number),
    SANDBOX_REAP_INTERVAL: positiveIntegerString.transform(Number),
    REVIEW_INTENT_POLL_INTERVAL_MS: nonNegativeIntegerString.transform(Number).default(1_000),
    ENGINE_IDLE_SHUTDOWN_SECONDS: positiveIntegerString.transform(Number).optional(),
    ENABLE_PROMPT_CACHING_1H: booleanFlag.default(false),
    ANTHROPIC_ADMIN_KEY: z.string().min(1),
    REVIEWS_ENABLED: booleanFlag.default(true),
    WEFT_INSPECTOR: booleanFlag.default(false),
  })
  .superRefine((environment, context) => {
    if (!environment.WEFT_DATABASE_URL && !environment.TRIBUNAL_ENGINE_ALLOW_EPHEMERAL_STORAGE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEFT_DATABASE_URL'],
        message: 'WEFT_DATABASE_URL is required unless ephemeral storage is explicitly enabled',
      });
    }
  });

export type EngineEnvironment = z.infer<typeof engineEnvironmentSchema>;

export function parseEngineEnvironment(
  environment: Record<string, string | undefined>,
): EngineEnvironment {
  return engineEnvironmentSchema.parse(environment);
}
