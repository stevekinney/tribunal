import { describe, expect, it } from 'vitest';
import { parseProxyEnvironment } from './environment';

const fullEnvironment = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/tribunal',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'a'.repeat(64),
  GITHUB_APP_ID: '123',
  GITHUB_APP_PRIVATE_KEY: 'private-key',
  ANTHROPIC_API_KEY: 'anthropic-key',
  TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.test',
  TRIBUNAL_PROXY_CIDR: '10.0.0.10/32',
  PROXY_CA_CERT: '-----BEGIN CERTIFICATE-----test-----END CERTIFICATE-----',
  PROXY_SIGNING_KEY: 'proxy-signing-key',
  GITHUB_EGRESS_ALLOW: 'api.github.com, github.com',
  ANTHROPIC_EGRESS_ALLOW: 'api.anthropic.com',
};

describe('parseProxyEnvironment', () => {
  it('parses the full proxy environment fixture', () => {
    expect(parseProxyEnvironment(fullEnvironment)).toMatchObject({
      TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.test',
      GITHUB_EGRESS_ALLOW: ['api.github.com', 'github.com'],
      ANTHROPIC_EGRESS_ALLOW: ['api.anthropic.com'],
    });
  });

  it('throws when a required proxy variable is missing', () => {
    const { PROXY_SIGNING_KEY: _removed, ...missingSigningKey } = fullEnvironment;

    expect(() => parseProxyEnvironment(missingSigningKey)).toThrow();
  });

  it('throws when Redis is missing', () => {
    const { REDIS_URL: _removed, ...missingRedis } = fullEnvironment;

    expect(() => parseProxyEnvironment(missingRedis)).toThrow();
  });

  it('throws when the encryption key is not a 64-character hex string', () => {
    expect(() =>
      parseProxyEnvironment({ ...fullEnvironment, ENCRYPTION_KEY: `${'a'.repeat(64)}zz` }),
    ).toThrow();
  });
});
