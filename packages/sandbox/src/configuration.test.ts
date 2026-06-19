import { describe, expect, it } from 'vitest';
import {
  buildProxyOnlyEgressConfiguration,
  makeSandboxMetadata,
  makeSandboxName,
  validateCloneInput,
  verifySandboxReuseIsolation,
} from './configuration';

describe('sandbox configuration', () => {
  it('generates deterministic sandbox names and metadata', () => {
    expect(makeSandboxName({ repositoryId: 42, pullRequestNumber: 7 })).toBe('tribunal-pr-42-7');
    expect(
      Object.keys(
        makeSandboxMetadata({
          repositoryId: 42,
          pullRequestNumber: 7,
          owner: 'stevekinney',
          name: 'tribunal',
        }),
      ),
    ).toEqual(['managedBy', 'owner', 'pullRequestNumber', 'repositoryId', 'repositoryName']);
  });

  it('represents proxy-only egress without credentials', () => {
    expect(
      buildProxyOnlyEgressConfiguration({
        proxyUrl: 'https://proxy.tribunal.local',
        proxyCidr: '10.0.0.8/32',
      }),
    ).toEqual({
      allowInternetAccess: false,
      allowOut: ['10.0.0.8/32'],
      secretNames: [],
      env: {
        TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.local',
        ANTHROPIC_BASE_URL: 'https://proxy.tribunal.local/anthropic/api.anthropic.com',
      },
    });
  });

  it('verifies existing sandbox isolation before named sandbox reuse', () => {
    const expected = buildProxyOnlyEgressConfiguration({
      proxyUrl: 'https://proxy.tribunal.local',
      proxyCidr: '10.0.0.8/32',
    });

    expect(
      verifySandboxReuseIsolation(
        {
          network: { allowInternetAccess: false, allowOut: ['10.0.0.8/32'] },
          secretNames: [],
        },
        expected,
      ),
    ).toEqual({ ok: true });
    expect(verifySandboxReuseIsolation({}, expected)).toMatchObject({ ok: false });
    expect(
      verifySandboxReuseIsolation(
        { network: { allowInternetAccess: false, allowOut: ['10.0.0.8/32'] } },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      reason: 'sandbox has retained secret names or secretNames is unknown',
    });
    expect(
      verifySandboxReuseIsolation(
        {
          network: { allowInternetAccess: false, allowOut: ['10.0.0.8/32'] },
          secretNames: 'ANTHROPIC_API_KEY',
        },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      reason: 'sandbox has retained secret names or secretNames is unknown',
    });
    expect(
      verifySandboxReuseIsolation(
        { network: { allowInternetAccess: true, allowOut: ['10.0.0.8/32'] }, secretNames: [] },
        expected,
      ),
    ).toMatchObject({ ok: false });
    expect(
      verifySandboxReuseIsolation(
        { network: { allowInternetAccess: false, allowOut: [] }, secretNames: [] },
        expected,
      ),
    ).toMatchObject({ ok: false });
    expect(
      verifySandboxReuseIsolation(
        {
          network: { allowInternetAccess: false, allowOut: ['10.0.0.8/32'] },
          secretNames: ['ANTHROPIC_API_KEY'],
        },
        expected,
      ),
    ).toMatchObject({
      ok: false,
      reason: 'sandbox has retained secret names or secretNames is unknown',
    });
  });

  it('keeps sandbox reuse verification limited to fields returned by the sandbox API', () => {
    expect(
      verifySandboxReuseIsolation(
        {
          network: { allowInternetAccess: false, allowOut: ['10.0.0.8/32'] },
          secretNames: [],
        },
        {
          allowInternetAccess: false,
          allowOut: ['10.0.0.8/32'],
          secretNames: [],
        },
      ),
    ).toEqual({ ok: true });
  });

  it('normalizes the Anthropic proxy base URL when the proxy URL has a trailing slash', () => {
    const configuration = buildProxyOnlyEgressConfiguration({
      proxyUrl: 'https://proxy.tribunal.local/',
      proxyCidr: '10.0.0.8/32',
    });

    expect(configuration.env.ANTHROPIC_BASE_URL).toBe(
      'https://proxy.tribunal.local/anthropic/api.anthropic.com',
    );
    expect(configuration.env.TRIBUNAL_PROXY_URL).toBe('https://proxy.tribunal.local');
  });

  it('rejects invalid repository clone inputs', () => {
    expect(
      validateCloneInput({
        repositoryUrl: 'https://proxy.tribunal.local/github/github.com/owner/repository.git',
        headSha: 'a'.repeat(40),
      }).ok,
    ).toBe(true);
    expect(
      validateCloneInput({
        repositoryUrl: 'https://github.com/owner/repository.git',
        headSha: 'a'.repeat(40),
      }).ok,
    ).toBe(false);
    expect(
      validateCloneInput({
        repositoryUrl: 'https://github.com/github/github.com/owner/repository.git',
        headSha: 'a'.repeat(40),
      }).ok,
    ).toBe(false);
    expect(
      validateCloneInput({
        repositoryUrl: 'https://proxy.tribunal.local/github/github.com/owner/repository.git',
        headSha: 'not-a-sha',
      }).ok,
    ).toBe(false);
  });
});
