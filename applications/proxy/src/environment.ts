import { z } from 'zod';

const hostAllowlist = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );

export const proxyEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  TRIBUNAL_PROXY_URL: z.string().url(),
  TRIBUNAL_PROXY_CIDR: z.string().min(1),
  PROXY_CA_CERT: z.string().min(1),
  PROXY_SIGNING_KEY: z.string().min(1),
  GITHUB_EGRESS_ALLOW: hostAllowlist,
  ANTHROPIC_EGRESS_ALLOW: hostAllowlist,
});

export type ProxyEnvironment = z.infer<typeof proxyEnvironmentSchema>;

export function parseProxyEnvironment(
  environment: Record<string, string | undefined>,
): ProxyEnvironment {
  return proxyEnvironmentSchema.parse(environment);
}
