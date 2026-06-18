import { describe, expect, it } from 'vitest';
import { buildProxyOnlyEgressConfiguration } from './configuration';

const credentialPatterns = [
  /ANTHROPIC_API_KEY/u,
  /GITHUB_TOKEN/u,
  /GH_TOKEN/u,
  /gh[oprsu]_[A-Za-z0-9_]+/u,
  /github_pat_[A-Za-z0-9_]+/u,
  /sk-ant-[A-Za-z0-9_-]+/u,
];

describe('sandbox security verification', () => {
  it('does not place real credentials in sandbox environment, secrets, or launch arguments', () => {
    const configuration = buildProxyOnlyEgressConfiguration({
      proxyUrl: 'https://proxy.tribunal.internal',
      proxyCidr: '10.0.0.10/32',
    });
    const launchArguments = [
      '--repository',
      'https://github.com/lostgradient/tribunal.git',
      '--head',
      'a'.repeat(40),
      '--capability-token-file',
      '/run/tribunal/capability-token',
    ];
    const serializedLaunch = JSON.stringify({ configuration, launchArguments });

    expect(configuration.secretNames).toEqual([]);
    expect(Object.keys(configuration.env)).toEqual(['TRIBUNAL_PROXY_URL', 'ANTHROPIC_BASE_URL']);
    expect(configuration.allowInternetAccess).toBe(false);
    expect(configuration.allowOut).toEqual(['10.0.0.10/32']);
    for (const pattern of credentialPatterns) {
      expect(serializedLaunch).not.toMatch(pattern);
    }
  });
});
