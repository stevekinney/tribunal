/**
 * OAuth Provider Registry - Single Source of Truth
 *
 * This module defines application-owned OAuth connections used for provider
 * API access. Neon Auth owns login identity.
 */
import { GitHub } from 'arctic';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import { AUTH_PROVIDER_LIST } from '$lib/constants/authorization-providers';
import type { AuthProvider } from '$lib/constants/authorization-providers';

// Re-export type for convenience
export type { AuthProvider };

const localGithubRedirectUri = 'http://localhost:5173/connect/github/account/callback';

export function getGithubRedirectUri(): string | null {
  const configuredRedirectUri = env.GITHUB_REDIRECT_URI?.trim();
  if (configuredRedirectUri) return configuredRedirectUri;

  return dev ? localGithubRedirectUri : null;
}

/**
 * Provider configuration registry
 */
export const AUTH_PROVIDERS = {
  github: {
    name: 'GitHub',
    icon: 'github',
    client: () =>
      new GitHub(env.GITHUB_CLIENT_ID!, env.GITHUB_CLIENT_SECRET!, getGithubRedirectUri()),
  },
} as const satisfies Record<AuthProvider, { name: string; icon: string; client: () => unknown }>;

// Cached OAuth client instances (avoid creating new instance on each call)
const clientCache = new Map<
  AuthProvider,
  ReturnType<(typeof AUTH_PROVIDERS)[AuthProvider]['client']>
>();

/**
 * Get a cached OAuth client for the specified provider.
 * Clients are lazily initialized and cached for the lifetime of the process.
 */
export function getProviderClient<T extends AuthProvider>(
  provider: T,
): ReturnType<(typeof AUTH_PROVIDERS)[T]['client']> {
  let client = clientCache.get(provider);
  if (!client) {
    client = AUTH_PROVIDERS[provider].client() as ReturnType<(typeof AUTH_PROVIDERS)[T]['client']>;
    clientCache.set(provider, client);
  }
  return client as ReturnType<(typeof AUTH_PROVIDERS)[T]['client']>;
}

/**
 * Get provider display information
 */
export function getProviderInfo(provider: AuthProvider): { name: string; icon: string } {
  return {
    name: AUTH_PROVIDERS[provider].name,
    icon: AUTH_PROVIDERS[provider].icon,
  };
}

// Runtime assertion to catch drift between server and shared modules
// Only runs in dev to avoid crashing prod on deploy race conditions
if (dev) {
  const serverProviders = Object.keys(AUTH_PROVIDERS) as string[];
  const sharedProviders = AUTH_PROVIDER_LIST as readonly string[];

  if (
    serverProviders.length !== sharedProviders.length ||
    !serverProviders.every((p) => sharedProviders.includes(p))
  ) {
    throw new Error(
      `AUTH_PROVIDERS mismatch! Server: [${serverProviders}], Shared: [${sharedProviders}]. ` +
        `Update $lib/constants/authorization-providers to match.`,
    );
  }
}
