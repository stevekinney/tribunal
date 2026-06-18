import { createDatabase } from '@tribunal/database';
import { sql } from '@tribunal/database/operators';
import { createGithubApplicationSingleton } from '@tribunal/github';
import { createCache } from '@tribunal/github/cache';
import type { GithubServiceContext } from '@tribunal/github/context';
import { mintSingleRepositoryReadToken } from '@tribunal/github/reviews/read-tokens';
import type { CapabilityTokenClaims } from '@tribunal/review-core/capability-token';
import { parseProxyEnvironment } from './environment';
import { createProxyHandler } from './proxy';
import type { ProxyEnvironment } from './environment';

export function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : fallback;
}

if (import.meta.main) {
  const port = parsePort(Bun.env.PORT, 3002);
  const environment = parseProxyEnvironment(Bun.env);
  const proxyHandler = createProxyHandler({
    environment,
    githubCredentialResolver: createProxyGitHubCredentialResolver(environment),
    healthDependencies: createProxyHealthDependencies(environment),
  });

  Bun.serve({
    port,
    fetch: proxyHandler,
  });
}

export function createProxyHealthDependencies(environment: ProxyEnvironment) {
  const database = createDatabase(environment.DATABASE_URL);
  return async () => {
    try {
      await database.execute(sql`SELECT 1`);
      return [{ name: 'database' as const, ok: true }];
    } catch (error) {
      return [
        {
          name: 'database' as const,
          ok: false,
          detail: error instanceof Error ? error.message : 'database probe failed',
        },
      ];
    }
  };
}

export function createProxyGitHubCredentialResolver(environment: ProxyEnvironment) {
  const database = createDatabase(environment.DATABASE_URL);
  const cache = createCache(() => environment.REDIS_URL);
  const githubApplication = createGithubApplicationSingleton(() => ({
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  }));
  const context: GithubServiceContext = {
    db: database,
    cache,
    getInstallationOctokit: githubApplication.getInstallationOctokit,
    getGithubApplication: githubApplication.getGithubApplication,
  };

  return async (claims: CapabilityTokenClaims): Promise<string | null> => {
    const token = await mintSingleRepositoryReadToken(context, {
      installationId: claims.installationId,
      repositoryId: claims.repositoryId,
    });
    return token.token;
  };
}
