import type { GithubServiceContext } from '../context.js';
import { cachedRead } from '../core/github-read-client.js';
import { requirePolicy } from '../core/cache-policy.js';
import { RateLimitError, ServiceUnavailableError, ValidationError } from '../error-taxonomy.js';
import { mintInstallationAccessToken, type InstallationToken } from '../installations/tokens.js';
import { isRetryableTokenError } from '../token-errors.js';

export interface MintSingleRepositoryReadTokenInput {
  installationId: number;
  repositoryId: number;
}

export async function mintSingleRepositoryReadToken(
  context: GithubServiceContext,
  input: MintSingleRepositoryReadTokenInput,
): Promise<InstallationToken> {
  const policy = requirePolicy('mint-single-repository-read-token');
  const { value } = await cachedRead(
    context.cache,
    policy,
    async () => {
      const result = await mintInstallationAccessToken(context, {
        installationId: input.installationId,
        repositoryIds: [input.repositoryId],
        permissions: {
          contents: 'read',
        },
      });

      if (!result.ok) {
        if (result.error.code === 'rate_limited') {
          throw new RateLimitError(result.error.message, result.error.retryAfterSeconds);
        }
        if (isRetryableTokenError(result.error.code)) {
          throw new ServiceUnavailableError('GitHub', result.error.message);
        }
        throw new ValidationError(result.error.message);
      }

      return { data: result.token };
    },
    [input.installationId, input.repositoryId],
  );

  return { ...value };
}
