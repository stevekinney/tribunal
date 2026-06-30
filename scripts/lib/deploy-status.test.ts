import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  collectLiveStateFailures,
  printStatus,
  type FlyState,
  type LiveStateOptions,
} from '../deploy';

const requiredSecrets = {
  'tribunal-proxy': [
    'DATABASE_URL',
    'REDIS_URL',
    'ENCRYPTION_KEY',
    'GITHUB_APP_ID',
    'ANTHROPIC_API_KEY',
    'TRIBUNAL_PROXY_URL',
    'TRIBUNAL_PROXY_CIDR',
    'PROXY_SIGNING_KEY',
    'GITHUB_APP_PRIVATE_KEY',
    'PROXY_CA_CERT',
  ],
  'tribunal-engine': [
    'DATABASE_URL',
    'WEFT_DATABASE_URL',
    'ENCRYPTION_KEY',
    'GITHUB_APP_ID',
    'TENSORLAKE_API_KEY',
    'TRIBUNAL_SANDBOX_IMAGE',
    'TRIBUNAL_PROXY_URL',
    'TRIBUNAL_PROXY_CIDR',
    'PROXY_SIGNING_KEY',
    'TRIBUNAL_ENGINE_CONTROL_TOKEN',
    'ANTHROPIC_ADMIN_KEY',
    'GITHUB_APP_PRIVATE_KEY',
  ],
  'tribunal-web': [
    'DATABASE_URL',
    'REDIS_URL',
    'ENCRYPTION_KEY',
    'PUBLIC_NEON_AUTH_URL',
    'NEON_AUTH_BASE_URL',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'GITHUB_REDIRECT_URI',
    'GITHUB_APP_ID',
    'GITHUB_APP_NAME',
    'GITHUB_APP_WEBHOOK_SECRET',
    'TRIBUNAL_ENGINE_CONTROL_TOKEN',
    'GITHUB_APP_PRIVATE_KEY',
  ],
} as const;

const strictOptions: LiveStateOptions = {
  allowMissingSandboxImage: false,
  allowPendingEngineMachine: false,
  allowPendingCostOptimization: false,
};

function createSetSecrets(): FlyState['setSecrets'] {
  return new Map(
    Object.entries(requiredSecrets).map(([app, secrets]) => [app, new Set(secrets)]),
  ) as FlyState['setSecrets'];
}

function createReadyMachine(
  id: string,
  environment: Record<string, string>,
  internalPort: number,
  autostop: 'stop' | 'off' | false,
): FlyState['appMachines'] extends Map<string, infer MachineState>
  ? Exclude<MachineState, null | 'unknown'>
  : never {
  return {
    count: 1,
    machines: [
      {
        id,
        state: 'stopped',
        environment,
        services: [
          {
            autostart: true,
            autostop,
            internalPort,
            minMachinesRunning: 0,
          },
        ],
      },
    ],
  };
}

function createFlyState(
  engineMachineCount: number,
  overrides: {
    engineEnvironment?: Record<string, string>;
    enginePrivateFlycastIp?: FlyState['enginePrivateFlycastIp'];
    webEnvironment?: Record<string, string>;
  } = {},
): FlyState {
  const engineMachineState =
    engineMachineCount === 0
      ? { count: 0, machines: [] }
      : createReadyMachine(
          'engine-machine',
          overrides.engineEnvironment ?? { TRIBUNAL_ENGINE_BIND_HOST: '0.0.0.0' },
          3001,
          false,
        );

  return {
    authenticated: true,
    account: 'hello@stevekinney.net',
    appsReadable: true,
    appsUnreadableReason: null,
    existingApps: new Set(['tribunal-proxy', 'tribunal-engine', 'tribunal-web']),
    setSecrets: createSetSecrets(),
    proxyDedicatedIp: '37.16.12.55',
    engineHasPublicIp: false,
    enginePrivateFlycastIp:
      overrides.enginePrivateFlycastIp === undefined
        ? 'fdaa:38:9b3e:0:1::3'
        : overrides.enginePrivateFlycastIp,
    appMachines: new Map([
      ['tribunal-proxy', createReadyMachine('proxy-machine', {}, 3000, 'stop')],
      ['tribunal-engine', engineMachineState],
      [
        'tribunal-web',
        createReadyMachine(
          'web-machine',
          overrides.webEnvironment ?? { TRIBUNAL_ENGINE_URL: 'http://tribunal-engine.flycast' },
          3000,
          'stop',
        ),
      ],
    ]) as FlyState['appMachines'],
    engineMachineCount,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('collectLiveStateFailures', () => {
  it('allows the engine Machine to be pending during first-deploy live status checks', () => {
    expect(
      collectLiveStateFailures(createFlyState(0), {
        ...strictOptions,
        allowPendingEngineMachine: true,
      }),
    ).toEqual([]);
  });

  it('requires the engine Machine once pending engine rollout is not allowed', () => {
    expect(collectLiveStateFailures(createFlyState(0), strictOptions)).toContain(
      'tribunal-engine has 0 Machines; expected 1',
    );
  });

  it('requires the web Machine to expose the Flycast engine URL', () => {
    expect(
      collectLiveStateFailures(createFlyState(1, { webEnvironment: {} }), strictOptions),
    ).toContain('tribunal-web TRIBUNAL_ENGINE_URL is not set; expected Flycast URL');
  });

  it('requires the engine Machine to bind for Flycast traffic', () => {
    expect(
      collectLiveStateFailures(createFlyState(1, { engineEnvironment: {} }), strictOptions),
    ).toContain(
      'tribunal-engine TRIBUNAL_ENGINE_BIND_HOST is not set; expected 0.0.0.0 for Flycast',
    );
  });
});

describe('printStatus', () => {
  it('reports a missing engine Flycast address when the engine app exists', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printStatus(createFlyState(1, { enginePrivateFlycastIp: null }));

    expect(
      log.mock.calls
        .flat()
        .some((line) => String(line).includes('engine Flycast private IPv6: not allocated')),
    ).toBe(true);
  });
});
