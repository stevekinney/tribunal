import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
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

type EncryptedInstallationToken = Omit<InstallationToken, 'token'> & {
  encryptedToken: string;
};

const tokenEncryptionAlgorithm = 'aes-256-gcm';

export async function mintSingleRepositoryReadToken(
  context: GithubServiceContext,
  input: MintSingleRepositoryReadTokenInput,
): Promise<InstallationToken> {
  const policy = requirePolicy('mint-single-repository-read-token');
  const fetchToken = async () => {
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

    return { data: encryptInstallationToken(result.token) };
  };
  const { value } = await cachedRead(context.cache, policy, fetchToken, [
    input.installationId,
    input.repositoryId,
  ]);

  try {
    return decryptInstallationToken(value);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
  }

  const cacheKey = policy.keyFactory(input.installationId, input.repositoryId);
  await context.cache.deleteCache(cacheKey);
  const fresh = await cachedRead(
    context.cache,
    policy,
    fetchToken,
    [input.installationId, input.repositoryId],
    {
      bypass: true,
    },
  );
  return decryptInstallationToken(fresh.value);
}

export function encryptInstallationToken(token: InstallationToken): EncryptedInstallationToken {
  const key = getTokenEncryptionKey();
  const initializationVector = randomBytes(16);
  const cipher = createCipheriv(tokenEncryptionAlgorithm, key, initializationVector);
  let encryptedToken = cipher.update(token.token, 'utf8', 'hex');
  encryptedToken += cipher.final('hex');
  const authenticationTag = cipher.getAuthTag().toString('hex');

  return {
    encryptedToken: [initializationVector.toString('hex'), authenticationTag, encryptedToken].join(
      ':',
    ),
    expiresAt: token.expiresAt,
    installationId: token.installationId,
  };
}

export function decryptInstallationToken(token: EncryptedInstallationToken): InstallationToken {
  const key = getTokenEncryptionKey();
  if (typeof token.encryptedToken !== 'string') {
    throw new ValidationError('Cached GitHub installation token is not encrypted.');
  }
  const [initializationVectorHex, authenticationTagHex, encryptedToken] =
    token.encryptedToken.split(':');
  if (!initializationVectorHex || !authenticationTagHex || !encryptedToken) {
    throw new ValidationError('Cached GitHub installation token is not encrypted.');
  }

  const decipher = createDecipheriv(
    tokenEncryptionAlgorithm,
    key,
    Buffer.from(initializationVectorHex, 'hex'),
  );
  let plaintext: string;
  try {
    decipher.setAuthTag(Buffer.from(authenticationTagHex, 'hex'));
    plaintext = decipher.update(encryptedToken, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
  } catch {
    throw new ValidationError('Cached GitHub installation token is not encrypted.');
  }

  return {
    token: plaintext,
    expiresAt: token.expiresAt,
    installationId: token.installationId,
  };
}

function getTokenEncryptionKey(): Buffer {
  const configuredKey = process.env.ENCRYPTION_KEY;
  if (!configuredKey)
    throw new ValidationError('ENCRYPTION_KEY is required to cache GitHub tokens.');

  if (!/^[a-fA-F0-9]{64}$/.test(configuredKey)) {
    throw new ValidationError('ENCRYPTION_KEY must be 32 bytes (64 hex characters).');
  }
  return Buffer.from(configuredKey, 'hex');
}
