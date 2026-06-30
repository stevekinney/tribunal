#!/usr/bin/env bun
/// <reference types="bun-types" />

/**
 * Tribunal deploy manager.
 *
 * Turns the static `DEPLOYMENT.md` checklist into a live, environment-aware
 * runbook. It validates that the local `.env` holds every value a deploy needs,
 * inspects the actual state of the three Fly apps, and prints the exact,
 * status-filtered commands for whatever work remains.
 *
 * This script is intentionally read-only. It never allocates IPs, sets secrets,
 * scales machines, or deploys -- those steps are billable, production-facing, or
 * side-effecting (`flyctl secrets set` triggers an immediate redeploy), so they
 * stay deliberate operator actions. The script's job is to tell you precisely
 * what to run and in what order.
 *
 * Usage:
 *   bun run scripts/deploy.ts                     Validate env, report status, print plan.
 *   bun run scripts/deploy.ts --live-status-only  Check Fly production invariants only.
 *   bun run scripts/deploy.ts --live-status-only --allow-missing-sandbox-image
 *                                                 Allow pre-deploy image refresh.
 *   bun run scripts/deploy.ts --live-status-only --allow-pending-engine-machine
 *                                                 Allow first deploy to create the engine Machine.
 *   bun run scripts/deploy.ts --live-status-only --allow-pending-cost-optimization
 *                                                 Allow first deploy to apply idle Machine settings.
 *   bun run scripts/deploy.ts --help              Show this help.
 */

import {
  sectionHeader,
  summaryHeader,
  errorHeader,
  status,
  success,
  error,
  warning,
  info,
  dim,
  bold,
  listItem,
} from './lib/colors';

// ---------------------------------------------------------------------------
// Secret and app specifications (mirrors DEPLOYMENT.md "Fly Secrets")
// ---------------------------------------------------------------------------

type AppName = 'tribunal-proxy' | 'tribunal-engine' | 'tribunal-web';

type App = {
  name: AppName;
  config: string;
  /**
   * The complete set of secret keys this app requires. Each is read from the
   * local environment and set on Fly under the same name (multiline values like
   * `GITHUB_APP_PRIVATE_KEY` and `PROXY_CA_CERT` live directly in `.env`; Bun's
   * native loader handles their newlines).
   *
   * This list doubles as an allowlist: a key absent here is never set on this
   * app, which is what mechanically prevents DEPLOYMENT.md's "Do Not Set"
   * mistakes (for example `WEFT_DATABASE_URL` only ever appears on the engine,
   * never on web).
   */
  secrets: string[];
};

/**
 * Deploy dependency order: proxy first (engine trusts it), then engine, then
 * web. The status and plan output both walk the apps in this order.
 */
const APPS: App[] = [
  {
    name: 'tribunal-proxy',
    config: 'deployment/fly/proxy.toml',
    secrets: [
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
  },
  {
    name: 'tribunal-engine',
    config: 'deployment/fly/engine.toml',
    secrets: [
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
  },
  {
    name: 'tribunal-web',
    config: 'deployment/fly/web.toml',
    secrets: [
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
  },
];

/**
 * Orchestration values the script needs that are not themselves Fly secrets.
 *
 * `MIGRATION_DATABASE_URL` is the direct, unpooled Neon URL used only for
 * migrations -- deliberately separate from the pooled `DATABASE_URL` runtime
 * connection so we never run migrations through the pooler.
 */
const ORCHESTRATION_VARS = [
  { envVar: 'FLY_ORG', description: 'Fly organization that owns the three apps' },
  {
    envVar: 'MIGRATION_DATABASE_URL',
    description: 'Direct (unpooled) Neon URL used only for migrations',
  },
] as const;

// ---------------------------------------------------------------------------
// flyctl helpers
// ---------------------------------------------------------------------------

/** Pick the first defined value among candidate keys (flyctl JSON casing varies). */
function pick<T = unknown>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key] as T;
  }
  return undefined;
}

type FlyResult = { exitCode: number; stdout: string; stderr: string };

/** Hard ceiling on any single flyctl call so a hung CLI never wedges the script. */
const FLYCTL_TIMEOUT_MS = 30_000;

/**
 * Run flyctl with arguments escaped individually; never throws. A hung call is
 * killed after FLYCTL_TIMEOUT_MS and reported as a non-zero exit, which every
 * caller already treats as a read failure ('unknown' / not authenticated).
 */
async function flyctl(args: string[]): Promise<FlyResult> {
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn(['flyctl', ...args], { stdout: 'pipe', stderr: 'pipe' });
  } catch (err) {
    // Bun.spawn can throw on spawn failure (permissions, corrupted binary).
    // Honor the never-throws contract: report it as a read failure instead.
    return { exitCode: 126, stdout: '', stderr: err instanceof Error ? err.message : String(err) };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, FLYCTL_TIMEOUT_MS);
  try {
    // Read both pipes concurrently to avoid a buffer-fill deadlock.
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    if (timedOut) {
      return {
        exitCode: 124,
        stdout,
        stderr: `flyctl ${args[0]} timed out after ${FLYCTL_TIMEOUT_MS}ms`,
      };
    }
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

/** Run a `--json` flyctl command and parse it, or return null on any failure. */
async function flyctlJson<T>(args: string[]): Promise<T | null> {
  const result = await flyctl([...args, '--json']);
  if (result.exitCode !== 0) return null;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live status checks
// ---------------------------------------------------------------------------

/**
 * Fly address types that are NOT public ingress. The "engine must stay private"
 * gate treats every other type (`v4`, `v6`, `shared_v4`, `anycast`, and any
 * future token) as public, so an unrecognized type fails closed -- surfacing a
 * warning rather than silently passing a reachable engine. Flycast/private
 * addresses are reported as `private` by current flyctl and `private_v6` by
 * older output shapes. Egress addresses are outbound-only (static egress IPs for
 * allowlists), so they must not trip the ingress gate.
 */
const NON_INGRESS_IP_TYPES = new Set(['private', 'private_v6', 'egress_v4', 'egress_v6']);

/**
 * `number | 'unknown'` distinguishes a real flyctl read failure from a known
 * state, so a transient API error never masquerades as an ordinary deploy step.
 */
type ReadFailure = 'unknown';

type MachineServiceConfiguration = {
  autostop?: unknown;
  autostart?: unknown;
  minMachinesRunning?: number | null;
  internalPort?: number;
};

type AppMachineSummary = {
  id: string;
  state: string;
  environment: Record<string, string>;
  services: MachineServiceConfiguration[];
};

type AppMachineState = {
  count: number;
  machines: AppMachineSummary[];
};

export type FlyState = {
  authenticated: boolean;
  account: string | null;
  /**
   * False when the app inventory could not be established. Every other field is
   * then meaningless, so status and plan abort rather than build on bad data.
   * `appsUnreadableReason` says why.
   */
  appsReadable: boolean;
  appsUnreadableReason: 'flyctl-error' | 'no-org' | null;
  existingApps: Set<string>;
  /**
   * Per app: the secret keys already set on Fly (names only, no values), or
   * 'unknown' when the per-app `secrets list` read failed.
   */
  setSecrets: Map<AppName, Set<string> | ReadFailure>;
  /** null = not allocated; 'unknown' = flyctl read failed. */
  proxyDedicatedIp: string | null | ReadFailure;
  /** null = engine not created; 'unknown' = flyctl read failed. */
  engineHasPublicIp: boolean | null | ReadFailure;
  /** null = engine not created or no Flycast address; 'unknown' = flyctl read failed. */
  enginePrivateFlycastIp: string | null | ReadFailure;
  /** Per-app non-destroyed Machine state, or 'unknown' when the read failed. */
  appMachines: Map<AppName, AppMachineState | ReadFailure | null>;
  /** null = engine not created; 'unknown' = flyctl read failed. */
  engineMachineCount: number | null | ReadFailure;
};

async function checkAuth(): Promise<{ authenticated: boolean; account: string | null }> {
  const result = await flyctl(['auth', 'whoami']);
  const account = result.stdout.trim();
  return { authenticated: result.exitCode === 0 && account.length > 0, account: account || null };
}

/**
 * Returns the set of app names in the given org, or null when the read failed.
 * The org is required: `flyctl apps list` spans every accessible org by default,
 * so an unscoped list could mistake a same-named app elsewhere for ours.
 */
async function listApps(org: string): Promise<Set<string> | null> {
  const apps = await flyctlJson<Array<Record<string, unknown>>>(['apps', 'list', '--org', org]);
  if (apps === null) return null;
  const names = new Set<string>();
  for (const app of apps) {
    const name = pick<string>(app, 'Name', 'name');
    if (name) names.add(name);
  }
  return names;
}

async function listSetSecrets(app: AppName): Promise<Set<string> | ReadFailure> {
  const secrets = await flyctlJson<Array<Record<string, unknown>>>([
    'secrets',
    'list',
    '--app',
    app,
  ]);
  if (secrets === null) return 'unknown';
  const names = new Set<string>();
  for (const secret of secrets) {
    const name = pick<string>(secret, 'Name', 'name');
    if (name) names.add(name);
  }
  return names;
}

async function listPublicIps(app: AppName): Promise<{
  dedicatedV4: string | null;
  privateV6: string | null;
  public: boolean | ReadFailure;
}> {
  const ips = await flyctlJson<Array<Record<string, unknown>>>(['ips', 'list', '--app', app]);
  if (ips === null) return { dedicatedV4: null, privateV6: null, public: 'unknown' };
  let dedicatedV4: string | null = null;
  let privateV6: string | null = null;
  let isPublic = false;
  for (const ip of ips) {
    const type = pick<string>(ip, 'Type', 'type');
    const address = pick<string>(ip, 'Address', 'address');
    if (!type) continue;
    // Fail closed: anything that is not a known-private type counts as public.
    if (!NON_INGRESS_IP_TYPES.has(type)) isPublic = true;
    if (type === 'v4' && address) dedicatedV4 = address;
    if ((type === 'private' || type === 'private_v6') && address) privateV6 = address;
  }
  return { dedicatedV4, privateV6, public: isPublic };
}

async function listMachines(app: AppName): Promise<AppMachineState | ReadFailure> {
  const machines = await flyctlJson<Array<Record<string, unknown>>>([
    'machines',
    'list',
    '--app',
    app,
  ]);
  if (machines === null) return 'unknown';
  // Exclude tombstoned machines so a stale destroyed record never inflates the count.
  const liveMachines = machines
    .filter((machine) => pick<string>(machine, 'state', 'State') !== 'destroyed')
    .map(parseMachineSummary);
  return { count: liveMachines.length, machines: liveMachines };
}

function parseMachineSummary(machine: Record<string, unknown>): AppMachineSummary {
  const config = pick<Record<string, unknown>>(machine, 'config', 'Config') ?? {};
  const rawEnvironment = pick<Record<string, unknown>>(config, 'env', 'Env') ?? {};
  const rawServices = pick<unknown[]>(config, 'services', 'Services') ?? [];
  const services = Array.isArray(rawServices) ? rawServices.map(parseMachineService) : [];
  const environment = Object.fromEntries(
    Object.entries(rawEnvironment).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

  return {
    id: pick<string>(machine, 'id', 'ID') ?? 'unknown',
    state: pick<string>(machine, 'state', 'State') ?? 'unknown',
    environment,
    services,
  };
}

function parseMachineService(service: unknown): MachineServiceConfiguration {
  if (service === null || typeof service !== 'object') return {};
  const record = service as Record<string, unknown>;
  return {
    autostop: pick(record, 'autostop', 'auto_stop_machines', 'AutoStop', 'AutoStopMachines'),
    autostart: pick(record, 'autostart', 'auto_start_machines', 'AutoStart', 'AutoStartMachines'),
    minMachinesRunning:
      pick<number>(record, 'min_machines_running', 'minMachinesRunning', 'MinMachinesRunning') ??
      null,
    internalPort: pick<number>(record, 'internal_port', 'internalPort', 'InternalPort'),
  };
}

function getMachineState(state: FlyState, app: AppName): AppMachineState | ReadFailure | null {
  return state.appMachines.get(app) ?? null;
}

function getMachineCount(state: FlyState, app: AppName): number | ReadFailure | null {
  const machineState = getMachineState(state, app);
  if (machineState === 'unknown' || machineState === null) return machineState;
  return machineState.count;
}

function servicesForApp(
  state: FlyState,
  app: AppName,
): MachineServiceConfiguration[] | ReadFailure | null {
  const machineState = getMachineState(state, app);
  if (machineState === 'unknown' || machineState === null) return machineState;
  return machineState.machines.flatMap((machine) => machine.services);
}

function environmentValueForApp(
  state: FlyState,
  app: AppName,
  key: string,
): string | ReadFailure | null {
  const machineState = getMachineState(state, app);
  if (machineState === 'unknown' || machineState === null) return machineState;
  return machineState.machines[0]?.environment[key] ?? null;
}

function serviceAutoStopsWhenIdle(service: MachineServiceConfiguration): boolean {
  return service.autostop === true || service.autostop === 'stop';
}

function serviceAutoStopDisabled(service: MachineServiceConfiguration): boolean {
  return service.autostop === false || service.autostop === 'off';
}

function serviceAutoStarts(service: MachineServiceConfiguration): boolean {
  return service.autostart === true;
}

function serviceKeepsZeroMachinesWarm(service: MachineServiceConfiguration): boolean {
  return service.minMachinesRunning === 0;
}

async function gatherFlyState(): Promise<FlyState> {
  const auth = await checkAuth();
  if (!auth.authenticated) {
    return {
      authenticated: false,
      account: auth.account,
      appsReadable: false,
      appsUnreadableReason: null,
      existingApps: new Set(),
      setSecrets: new Map(),
      proxyDedicatedIp: null,
      engineHasPublicIp: null,
      enginePrivateFlycastIp: null,
      appMachines: new Map(),
      engineMachineCount: null,
    };
  }

  // App discovery must be scoped to the target org; without it, `apps list`
  // spans every accessible org and could mistake a same-named app for ours.
  const org = process.env.FLY_ORG?.trim();
  const unreadable = (reason: 'flyctl-error' | 'no-org'): FlyState => ({
    authenticated: true,
    account: auth.account,
    appsReadable: false,
    appsUnreadableReason: reason,
    existingApps: new Set(),
    setSecrets: new Map(),
    proxyDedicatedIp: 'unknown',
    engineHasPublicIp: 'unknown',
    enginePrivateFlycastIp: 'unknown',
    appMachines: new Map(APPS.map((app) => [app.name, 'unknown'])),
    engineMachineCount: 'unknown',
  });

  if (!org) return unreadable('no-org');

  const existingApps = await listApps(org);
  if (existingApps === null) return unreadable('flyctl-error');

  const setSecrets = new Map<AppName, Set<string> | ReadFailure>();
  await Promise.all(
    APPS.map(async (app) => {
      setSecrets.set(
        app.name,
        existingApps.has(app.name) ? await listSetSecrets(app.name) : new Set<string>(),
      );
    }),
  );

  const proxyExists = existingApps.has('tribunal-proxy');
  const engineExists = existingApps.has('tribunal-engine');

  const proxyIps = proxyExists ? await listPublicIps('tribunal-proxy') : null;
  const engineIps = engineExists ? await listPublicIps('tribunal-engine') : null;
  const appMachines = new Map<AppName, AppMachineState | ReadFailure | null>();
  await Promise.all(
    APPS.map(async (app) => {
      appMachines.set(app.name, existingApps.has(app.name) ? await listMachines(app.name) : null);
    }),
  );
  const engineMachines = appMachines.get('tribunal-engine');
  const engineMachineCount =
    engineMachines === undefined || engineMachines === null || engineMachines === 'unknown'
      ? (engineMachines ?? null)
      : engineMachines.count;

  // A failed proxy `ips list` must read as 'unknown', not as "not allocated".
  let proxyDedicatedIp: string | null | ReadFailure = null;
  if (proxyIps) proxyDedicatedIp = proxyIps.public === 'unknown' ? 'unknown' : proxyIps.dedicatedV4;
  const enginePrivateFlycastIp = engineIps
    ? engineIps.public === 'unknown'
      ? 'unknown'
      : engineIps.privateV6
    : null;

  return {
    authenticated: true,
    account: auth.account,
    appsReadable: true,
    appsUnreadableReason: null,
    existingApps,
    setSecrets,
    proxyDedicatedIp,
    engineHasPublicIp: engineIps ? engineIps.public : null,
    enginePrivateFlycastIp,
    appMachines,
    engineMachineCount,
  };
}

// ---------------------------------------------------------------------------
// Local environment validation
// ---------------------------------------------------------------------------

type MissingVar = { envVar: string; reason: string; usedBy: string[] };

/** All env keys the deploy needs, mapped to the apps/steps that consume them. */
function collectRequiredEnv(): Map<string, Set<string>> {
  const required = new Map<string, Set<string>>();

  const note = (envVar: string, usedBy: string) => {
    const entry = required.get(envVar) ?? new Set<string>();
    entry.add(usedBy);
    required.set(envVar, entry);
  };

  for (const app of APPS) {
    for (const key of app.secrets) note(key, app.name);
  }
  for (const { envVar, description } of ORCHESTRATION_VARS) note(envVar, description);

  return required;
}

/**
 * Format checks for the env vars with a crisp, documented shape. Catching a
 * malformed value here means the operator fixes it now, instead of the secret
 * being set successfully and only failing at service boot. Only unambiguous
 * formats are validated -- URLs and tokens of varying shape are left to presence.
 */
const FORMAT_VALIDATORS: Record<string, { test: (value: string) => boolean; expected: string }> = {
  // `openssl rand -hex 32` -> exactly 64 hex characters.
  ENCRYPTION_KEY: { test: (v) => /^[0-9a-f]{64}$/i.test(v), expected: '64 hex characters' },
  PROXY_SIGNING_KEY: { test: (v) => /^[0-9a-f]{64}$/i.test(v), expected: '64 hex characters' },
  TRIBUNAL_ENGINE_CONTROL_TOKEN: {
    test: (v) => /^[0-9a-f]{64}$/i.test(v),
    expected: '64 hex characters',
  },
  // Dedicated proxy IPv4 with a /32 suffix, e.g. 203.0.113.5/32. Each octet is
  // bounded to 0-255 so a syntactically-shaped but invalid value (999.999...)
  // is rejected here rather than at allocation time.
  TRIBUNAL_PROXY_CIDR: {
    test: (v) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}\/32$/.test(v),
    expected: 'an IPv4 address with /32 (e.g. 203.0.113.5/32)',
  },
};

function validateLocalEnv(): MissingVar[] {
  const required = collectRequiredEnv();
  const missing: MissingVar[] = [];

  for (const [envVar, usedBy] of required) {
    const rawValue = process.env[envVar];
    const present = rawValue !== undefined && rawValue.trim().length > 0;

    if (!present) {
      missing.push({ envVar, reason: 'not set', usedBy: [...usedBy] });
      continue;
    }

    const validator = FORMAT_VALIDATORS[envVar];
    if (validator && !validator.test(rawValue.trim())) {
      missing.push({
        envVar,
        reason: `invalid format (expected ${validator.expected})`,
        usedBy: [...usedBy],
      });
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

type StepState = 'done' | 'todo' | 'manual';

type Step = {
  title: string;
  state: StepState;
  /** Human-readable note about the current state (shown dimmed). */
  detail?: string;
  /** Commands the operator should run for a `todo`/`manual` step. */
  commands?: string[];
};

/** Build the shell snippet that sets one secret by reference, never by value. */
function secretAssignment(key: string): string {
  return `${key}="$${key}"`;
}

function buildPlan(state: FlyState): Step[] {
  const steps: Step[] = [];

  // 1. Authenticate.
  steps.push(
    state.authenticated
      ? { title: 'Authenticate with Fly', state: 'done', detail: `signed in as ${state.account}` }
      : { title: 'Authenticate with Fly', state: 'todo', commands: ['flyctl auth login'] },
  );

  // Nothing else is knowable until you authenticate; the auth step above already
  // carries the fix, so stop rather than infer apps/secrets from empty data.
  if (!state.authenticated) return steps;

  // The rest of the plan is derived from the app list. If it could not be read,
  // every step below would be built on empty data -- stop and say so plainly.
  if (!state.appsReadable) {
    const noOrg = state.appsUnreadableReason === 'no-org';
    steps.push({
      title: 'Read Fly app state',
      state: 'manual',
      detail: noOrg
        ? 'set FLY_ORG so app discovery is scoped to the target org (apps list spans all orgs)'
        : 'could not read `flyctl apps list`; resolve the flyctl error and re-run',
      commands: noOrg ? undefined : ['flyctl apps list --org "$FLY_ORG"'],
    });
    return steps;
  }

  // 2. Create the three apps.
  const missingApps = APPS.filter((app) => !state.existingApps.has(app.name));
  steps.push(
    missingApps.length === 0
      ? { title: 'Create Fly apps', state: 'done', detail: 'all three apps exist' }
      : {
          title: 'Create Fly apps',
          state: 'todo',
          detail: `missing: ${missingApps.map((a) => a.name).join(', ')}`,
          commands: missingApps.map((app) => `flyctl apps create ${app.name} --org "$FLY_ORG"`),
        },
  );

  // 3. Allocate a dedicated public IPv4 for the proxy (billable).
  const proxyIp = state.proxyDedicatedIp;
  if (!state.existingApps.has('tribunal-proxy')) {
    // The proxy app must exist before an IP can be allocated to it.
    steps.push({
      title: 'Allocate dedicated proxy IPv4',
      state: 'todo',
      detail: 'pending app creation',
    });
  } else if (proxyIp === 'unknown') {
    steps.push({
      title: 'Allocate dedicated proxy IPv4',
      state: 'manual',
      detail: 'could not read proxy IPs from flyctl; verify before allocating',
      commands: ['flyctl ips list --app tribunal-proxy'],
    });
  } else if (proxyIp) {
    steps.push({
      title: 'Allocate dedicated proxy IPv4',
      state: 'done',
      detail: `dedicated IPv4 ${proxyIp}`,
    });
  } else {
    steps.push({
      title: 'Allocate dedicated proxy IPv4',
      state: 'todo',
      detail: 'billable: a dedicated IPv4 carries a monthly charge (confirm the prompt)',
      // Dedicated is the default for `ips allocate-v4`; there is no --dedicated flag.
      commands: ['flyctl ips allocate-v4 --app tribunal-proxy'],
    });
  }

  // 4. Confirm TRIBUNAL_PROXY_CIDR matches the allocated IP. Trim to match
  // validateLocalEnv, so a value with surrounding whitespace can't pass
  // validation yet still report a mismatch here.
  const configuredCidr = process.env.TRIBUNAL_PROXY_CIDR?.trim();
  if (proxyIp === 'unknown') {
    steps.push({
      title: 'Confirm TRIBUNAL_PROXY_CIDR matches allocated IP',
      state: 'manual',
      detail: 'pending proxy IP read',
    });
  } else if (proxyIp) {
    const expectedCidr = `${proxyIp}/32`;
    if (configuredCidr === expectedCidr) {
      steps.push({
        title: 'Confirm TRIBUNAL_PROXY_CIDR matches allocated IP',
        state: 'done',
        detail: `${expectedCidr}`,
      });
    } else {
      steps.push({
        title: 'Confirm TRIBUNAL_PROXY_CIDR matches allocated IP',
        state: 'manual',
        detail: configuredCidr
          ? `mismatch: .env has ${configuredCidr}, expected ${expectedCidr}`
          : `set TRIBUNAL_PROXY_CIDR=${expectedCidr} in .env`,
      });
    }
  } else {
    steps.push({
      title: 'Confirm TRIBUNAL_PROXY_CIDR matches allocated IP',
      state: 'manual',
      detail: 'pending IPv4 allocation',
    });
  }

  // 5. Run migrations with the direct (unpooled) URL.
  if (!state.existingApps.has('tribunal-engine')) {
    steps.push({
      title: 'Allocate private engine Flycast address',
      state: 'todo',
      detail: 'pending app creation',
    });
  } else if (state.enginePrivateFlycastIp === 'unknown') {
    steps.push({
      title: 'Allocate private engine Flycast address',
      state: 'manual',
      detail: 'could not read engine IPs from flyctl; verify before allocating',
      commands: ['flyctl ips list --app tribunal-engine'],
    });
  } else if (state.enginePrivateFlycastIp) {
    steps.push({
      title: 'Allocate private engine Flycast address',
      state: 'done',
      detail: `private IPv6 ${state.enginePrivateFlycastIp}`,
    });
  } else {
    steps.push({
      title: 'Allocate private engine Flycast address',
      state: 'todo',
      detail: 'required for Flycast wake traffic to stopped private Machines',
      commands: ['flyctl ips allocate-v6 --private --app tribunal-engine'],
    });
  }

  // 6. Run migrations with the direct (unpooled) URL.
  steps.push({
    title: 'Run database migrations',
    state: 'manual',
    detail: 'uses the direct, unpooled Neon URL (not the pooled runtime DATABASE_URL)',
    commands: ['DATABASE_URL="$MIGRATION_DATABASE_URL" bun run db:migrate'],
  });

  // 7. Set secrets per app (proxy, engine, web).
  for (const app of APPS) {
    if (!state.existingApps.has(app.name)) {
      // The app must exist before secrets can be set; omit the command until
      // then (matches the proxy IPv4 and engine scale pending-prereq steps). It
      // appears below once the app exists and has unset secrets.
      steps.push({
        title: `Set secrets for ${app.name}`,
        state: 'todo',
        detail: 'pending app creation',
      });
      continue;
    }

    const setKeys = state.setSecrets.get(app.name);
    if (setKeys === 'unknown' || setKeys === undefined) {
      steps.push({
        title: `Set secrets for ${app.name}`,
        state: 'manual',
        detail: 'could not read current secrets from flyctl; verify before setting',
        commands: [`flyctl secrets list --app ${app.name}`],
      });
      continue;
    }

    const unset = app.secrets.filter((key) => !setKeys.has(key));

    if (unset.length === 0) {
      steps.push({
        title: `Set secrets for ${app.name}`,
        state: 'done',
        detail: `all ${app.secrets.length} secrets set`,
      });
      continue;
    }

    steps.push({
      title: `Set secrets for ${app.name}`,
      state: 'todo',
      detail: `${unset.length} of ${app.secrets.length} unset: ${unset.join(', ')}`,
      // The app already exists and may have running Machines, where `secrets set`
      // triggers an immediate redeploy. --stage is baked in so the copied command
      // defers the rollout to the explicit, dependency-ordered deploy step below.
      commands: [
        `flyctl secrets set --stage --app ${app.name} \\\n${unset
          .map(secretAssignment)
          .join(' \\\n')}`,
      ],
    });
  }

  // 8-10. Deploy each app in dependency order.
  const deployOrder: AppName[] = ['tribunal-proxy', 'tribunal-engine', 'tribunal-web'];
  for (const name of deployOrder) {
    const app = APPS.find((a) => a.name === name)!;
    // The app must exist before it can be deployed; omit the command until then
    // (matches the IPv4, secrets, and scale pending-prerequisite steps).
    steps.push(
      state.existingApps.has(app.name)
        ? {
            title: `Deploy ${app.name}`,
            state: 'manual',
            commands: [`flyctl deploy . --config ${app.config}`],
          }
        : { title: `Deploy ${app.name}`, state: 'todo', detail: 'pending app creation' },
    );

    const count = getMachineCount(state, name);
    const label = `Scale ${name} to exactly one Machine`;
    if (count === 1) {
      steps.push({
        title: label,
        state: 'done',
        detail: '1 Machine configured',
      });
    } else if (count === 'unknown') {
      steps.push({
        title: label,
        state: 'manual',
        detail: 'could not read Machine count from flyctl; verify before scaling',
        commands: [`flyctl machines list --app ${name}`],
      });
    } else if (count === null || count === 0) {
      steps.push({
        title: label,
        state: 'todo',
        detail:
          count === null ? 'pending app creation' : `${name} has no Machines yet (deploy first)`,
      });
    } else {
      steps.push({
        title: label,
        state: 'todo',
        detail: `${count} Machines configured`,
        commands: [`flyctl scale count 1 --yes --app ${name}`],
      });
    }
  }

  // 11. Confirm the engine has no public IP.
  if (state.engineHasPublicIp === null) {
    steps.push({
      title: 'Confirm engine has no public IP',
      state: 'manual',
      detail: 'engine app not yet created',
    });
  } else if (state.engineHasPublicIp === 'unknown') {
    steps.push({
      title: 'Confirm engine has no public IP',
      state: 'manual',
      detail: 'could not read IPs from flyctl; verify manually before enabling reviews',
      commands: ['flyctl ips list --app tribunal-engine'],
    });
  } else if (state.engineHasPublicIp) {
    steps.push({
      title: 'Confirm engine has no public IP',
      state: 'todo',
      detail: 'engine has a public IP; the engine must stay private',
      commands: [
        'flyctl ips list --app tribunal-engine',
        '# then release any public address: flyctl ips release <address> --app tribunal-engine',
      ],
    });
  } else {
    steps.push({
      title: 'Confirm engine has no public IP',
      state: 'done',
      detail: 'no public IP (engine is private)',
    });
  }

  // 12. Health gates before flipping REVIEWS_ENABLED.
  steps.push({
    title: 'Pass health gates before enabling live reviews',
    state: 'manual',
    detail:
      'health checks, unauthorized proxy 401/403, and the fake-load harness must pass; ' +
      'see documentation/deployment/containers.md. Keep REVIEWS_ENABLED=false until all gates pass.',
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function printMissingEnv(missing: MissingVar[]): void {
  console.log(errorHeader('Missing deploy configuration'));
  console.log('');
  console.log(
    error(
      `  ${missing.length} required environment ${
        missing.length === 1 ? 'variable is' : 'variables are'
      } missing or invalid.`,
    ),
  );
  console.log(dim('  Copy them into .env (Bun loads it automatically) and re-run.'));
  console.log('');

  for (const { envVar, reason, usedBy } of missing.sort((a, b) => (a.envVar < b.envVar ? -1 : 1))) {
    console.log(`  ${error('✗')} ${bold(envVar)} ${dim(`(${reason})`)}`);
    console.log(dim(`      used by: ${usedBy.join(', ')}`));
  }
  console.log('');
  console.log(dim('  Generated secrets (ENCRYPTION_KEY, PROXY_SIGNING_KEY,'));
  console.log(dim('  TRIBUNAL_ENGINE_CONTROL_TOKEN) come from `openssl rand -hex 32`.'));
  console.log(
    dim('  Multiline secrets (GITHUB_APP_PRIVATE_KEY, PROXY_CA_CERT) live directly in .env;'),
  );
  console.log(dim('  Bun loads their newlines when double-quoted.'));
  console.log('');
}

export function printStatus(state: FlyState): void {
  console.log(summaryHeader('Fly status'));
  console.log('');

  if (!state.authenticated) {
    console.log(status('error', 'Not authenticated with Fly (run `flyctl auth login`)'));
    console.log('');
    return;
  }

  console.log(status('success', `Authenticated as ${state.account}`));

  if (!state.appsReadable) {
    console.log(
      status(
        'error',
        state.appsUnreadableReason === 'no-org'
          ? 'FLY_ORG is not set; cannot scope app discovery to the target org'
          : 'Could not read `flyctl apps list` (resolve and re-run)',
      ),
    );
    console.log('');
    return;
  }

  for (const app of APPS) {
    const exists = state.existingApps.has(app.name);
    if (!exists) {
      console.log(status('error', `${app.name}: not created`));
      continue;
    }
    const setKeys = state.setSecrets.get(app.name);
    if (setKeys === 'unknown' || setKeys === undefined) {
      console.log(status('warning', `${app.name}: could not read secrets from flyctl`));
      continue;
    }
    const setCount = app.secrets.filter((key) => setKeys.has(key)).length;
    const level = setCount === app.secrets.length ? 'success' : 'warning';
    console.log(status(level, `${app.name}: ${setCount}/${app.secrets.length} secrets set`));
  }

  if (state.proxyDedicatedIp === 'unknown') {
    console.log(status('warning', 'proxy dedicated IPv4: could not read from flyctl'));
  } else {
    console.log(
      status(
        state.proxyDedicatedIp ? 'success' : 'warning',
        state.proxyDedicatedIp
          ? `proxy dedicated IPv4: ${state.proxyDedicatedIp}`
          : 'proxy dedicated IPv4: not allocated',
      ),
    );
  }

  if (state.engineHasPublicIp === 'unknown') {
    console.log(status('warning', 'engine IPs: could not read from flyctl'));
  } else if (state.engineHasPublicIp !== null) {
    console.log(
      status(
        state.engineHasPublicIp ? 'error' : 'success',
        state.engineHasPublicIp
          ? 'engine has a public IP (must be private)'
          : 'engine has no public IP',
      ),
    );
  }

  if (state.enginePrivateFlycastIp === 'unknown') {
    console.log(status('warning', 'engine Flycast IP: could not read from flyctl'));
  } else if (state.existingApps.has('tribunal-engine')) {
    console.log(
      status(
        state.enginePrivateFlycastIp ? 'success' : 'error',
        state.enginePrivateFlycastIp
          ? `engine Flycast private IPv6: ${state.enginePrivateFlycastIp}`
          : 'engine Flycast private IPv6: not allocated',
      ),
    );
  }

  for (const app of APPS) {
    const count = getMachineCount(state, app.name);
    if (count === 'unknown') {
      console.log(status('warning', `${app.name} Machines: could not read from flyctl`));
      continue;
    }
    if (count !== null) {
      console.log(
        status(
          count === 1 ? 'success' : 'warning',
          `${app.name} Machines: ${count} (must be exactly 1)`,
        ),
      );
    }
  }

  console.log('');
}

export type LiveStateOptions = {
  allowMissingSandboxImage: boolean;
  allowPendingEngineMachine: boolean;
  allowPendingCostOptimization: boolean;
};

export function collectLiveStateFailures(state: FlyState, options: LiveStateOptions): string[] {
  const failures: string[] = [];

  if (!state.authenticated) {
    failures.push('not authenticated with Fly');
    return failures;
  }

  if (!state.appsReadable) {
    failures.push(
      state.appsUnreadableReason === 'no-org'
        ? 'FLY_ORG is not set'
        : 'could not read Fly app list',
    );
    return failures;
  }

  for (const app of APPS) {
    if (!state.existingApps.has(app.name)) {
      failures.push(`${app.name} does not exist`);
      continue;
    }

    const setKeys = state.setSecrets.get(app.name);
    if (setKeys === 'unknown' || setKeys === undefined) {
      failures.push(`could not read secrets for ${app.name}`);
      continue;
    }

    const missingSecrets = app.secrets.filter((key) => {
      if (
        options.allowMissingSandboxImage &&
        app.name === 'tribunal-engine' &&
        key === 'TRIBUNAL_SANDBOX_IMAGE'
      ) {
        return false;
      }
      return !setKeys.has(key);
    });
    if (missingSecrets.length > 0) {
      failures.push(`${app.name} is missing secrets: ${missingSecrets.join(', ')}`);
    }
  }

  if (state.existingApps.has('tribunal-proxy')) {
    if (state.proxyDedicatedIp === 'unknown') {
      failures.push('could not read proxy IPs');
    } else if (!state.proxyDedicatedIp) {
      failures.push('tribunal-proxy does not have a dedicated IPv4');
    }
  }

  if (!options.allowPendingCostOptimization) {
    collectMachineCostFailures(state, options, failures);
  }

  if (state.existingApps.has('tribunal-engine')) {
    if (state.engineHasPublicIp === 'unknown') {
      failures.push('could not read engine IPs');
    } else if (state.engineHasPublicIp === true) {
      failures.push('tribunal-engine has a public IP');
    }

    if (state.enginePrivateFlycastIp === 'unknown') {
      failures.push('could not read engine Flycast IPs');
    } else if (!state.enginePrivateFlycastIp) {
      failures.push('tribunal-engine does not have a private Flycast IPv6 address');
    }

    if (state.engineMachineCount === 'unknown') {
      failures.push('could not read engine Machines');
    } else if (
      state.engineMachineCount !== null &&
      state.engineMachineCount !== 1 &&
      !(options.allowPendingEngineMachine && state.engineMachineCount === 0)
    ) {
      failures.push(`tribunal-engine has ${state.engineMachineCount} Machines; expected 1`);
    }
  }

  return failures;
}

function allowsPendingEngineMachine(
  app: AppName,
  count: number | ReadFailure | null,
  options: LiveStateOptions,
): boolean {
  return options.allowPendingEngineMachine && app === 'tribunal-engine' && count === 0;
}

function collectMachineCostFailures(
  state: FlyState,
  options: LiveStateOptions,
  failures: string[],
): void {
  for (const app of APPS) {
    const count = getMachineCount(state, app.name);
    if (count === 'unknown') {
      failures.push(`could not read Machines for ${app.name}`);
      continue;
    }
    if (count !== null && count !== 1 && !allowsPendingEngineMachine(app.name, count, options)) {
      failures.push(`${app.name} has ${count} Machines; expected 1`);
    }
  }

  for (const app of ['tribunal-web', 'tribunal-proxy'] as const) {
    const services = servicesForApp(state, app);
    if (services === 'unknown') {
      failures.push(`could not read service configuration for ${app}`);
      continue;
    }
    if (services === null) continue;
    if (services.length === 0) {
      failures.push(`${app} has no Fly service configuration`);
      continue;
    }
    if (!services.every(serviceAutoStopsWhenIdle)) {
      failures.push(`${app} does not stop Machines when idle`);
    }
    if (!services.every(serviceAutoStarts)) {
      failures.push(`${app} does not auto-start Machines`);
    }
    if (!services.every(serviceKeepsZeroMachinesWarm)) {
      failures.push(`${app} keeps warm Machines running`);
    }
  }

  const webEngineUrl = environmentValueForApp(state, 'tribunal-web', 'TRIBUNAL_ENGINE_URL');
  if (webEngineUrl === 'unknown') {
    failures.push('could not read tribunal-web environment');
  } else if (webEngineUrl === null) {
    failures.push('tribunal-web TRIBUNAL_ENGINE_URL is not set; expected Flycast URL');
  } else if (webEngineUrl !== 'http://tribunal-engine.flycast') {
    failures.push(`tribunal-web TRIBUNAL_ENGINE_URL is ${webEngineUrl}; expected Flycast URL`);
  }

  const engineMachineCount = getMachineCount(state, 'tribunal-engine');
  if (!allowsPendingEngineMachine('tribunal-engine', engineMachineCount, options)) {
    const engineBindHost = environmentValueForApp(
      state,
      'tribunal-engine',
      'TRIBUNAL_ENGINE_BIND_HOST',
    );
    if (engineBindHost === 'unknown') {
      failures.push('could not read tribunal-engine environment');
    } else if (engineBindHost === null) {
      failures.push(
        'tribunal-engine TRIBUNAL_ENGINE_BIND_HOST is not set; expected 0.0.0.0 for Flycast',
      );
    } else if (engineBindHost !== '0.0.0.0') {
      failures.push(`tribunal-engine binds ${engineBindHost}; expected 0.0.0.0 for Flycast`);
    }

    const engineServices = servicesForApp(state, 'tribunal-engine');
    if (engineServices === 'unknown') {
      failures.push('could not read service configuration for tribunal-engine');
    } else if (engineServices !== null) {
      if (engineServices.length === 0) {
        failures.push('tribunal-engine has no private Flycast service configuration');
      } else if (
        !engineServices.some(
          (service) =>
            service.internalPort === 3001 &&
            serviceAutoStarts(service) &&
            serviceKeepsZeroMachinesWarm(service) &&
            serviceAutoStopDisabled(service),
        )
      ) {
        failures.push(
          'tribunal-engine Flycast service must use internal port 3001, auto-start, min 0, and autostop off',
        );
      }
    }
  }
}

const STATE_SYMBOL: Record<StepState, string> = {
  done: success('✓'),
  todo: warning('○'),
  manual: info('●'),
};

function printPlan(steps: Step[]): void {
  console.log(summaryHeader('Deploy plan'));
  console.log('');
  console.log(dim('  ✓ done   ○ to do   ● operator action (run manually; not auto-verified)'));
  console.log('');
  // The `KEY="$KEY"` commands below read from the shell environment. Bun loads
  // .env for this script, but a normal shell does not -- load it first. The `.`
  // (dot) command is POSIX-portable; `source` is the bash/zsh spelling.
  console.log(dim('  Commands referencing $VARS need .env loaded into your shell first:'));
  console.log(info('  $ set -a && . ./.env && set +a   # bash/zsh: source ./.env'));
  console.log('');
  // The deploy/migration commands assume `flyctl deploy .` and
  // `--config deployment/...` are run from the repository root. Fly reads the
  // Dockerfile path from each app's deployment/fly/*.toml file.
  console.log(dim('  Run these commands from the repository root.'));
  console.log('');

  let index = 0;
  for (const step of steps) {
    index += 1;
    const symbol = STATE_SYMBOL[step.state];
    const number = dim(String(index).padStart(2, ' ') + '.');
    console.log(`  ${number} ${symbol} ${bold(step.title)}`);
    if (step.detail) console.log(dim(`        ${step.detail}`));
    for (const command of step.commands ?? []) {
      if (step.state === 'done') continue;
      // Comment-only hint lines render as dim comments, not as `$ #` commands.
      if (command.startsWith('#')) {
        console.log(dim(`        ${command}`));
        continue;
      }
      // Indent multi-line commands so continuation lines stay aligned under the
      // first line's content (8 spaces of margin + "$ ").
      const [first, ...rest] = command.split('\n');
      console.log(info(`        $ ${first}`));
      for (const line of rest) console.log(info(`          ${line}`));
    }
  }
  console.log('');
}

function printHelp(): void {
  console.log(sectionHeader('Tribunal Deploy Manager'));
  console.log('');
  console.log('  Validates local deploy configuration, inspects live Fly state, and');
  console.log('  prints the exact remaining commands from DEPLOYMENT.md as a runbook.');
  console.log('');
  console.log(bold('  This script is read-only.') + ' It never deploys, sets secrets, allocates');
  console.log('  IPs, or scales Machines. It tells you what to run, in order.');
  console.log('');
  console.log(bold('  Usage:'));
  console.log(listItem('bun run scripts/deploy.ts          Validate, report status, print plan'));
  console.log(listItem('bun run scripts/deploy.ts --live-status-only'));
  console.log(
    dim('    Check live Fly production invariants without requiring local secret values.'),
  );
  console.log(
    listItem('bun run scripts/deploy.ts --live-status-only --allow-missing-sandbox-image'),
  );
  console.log(dim('    Allow pre-deploy automation to refresh TRIBUNAL_SANDBOX_IMAGE.'));
  console.log(
    listItem('bun run scripts/deploy.ts --live-status-only --allow-pending-engine-machine'),
  );
  console.log(dim('    Allow first-deploy automation to create the engine Machine.'));
  console.log(
    listItem('bun run scripts/deploy.ts --live-status-only --allow-pending-cost-optimization'),
  );
  console.log(dim('    Allow first-deploy automation to apply idle Machine settings.'));
  console.log(listItem('bun run scripts/deploy.ts --help   Show this help'));
  console.log('');
  console.log(dim('  All values live in .env; multiline secrets (GITHUB_APP_PRIVATE_KEY,'));
  console.log(dim('  PROXY_CA_CERT) are stored directly as double-quoted values.'));
  console.log('');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  console.log(sectionHeader('Tribunal Deploy Manager'));

  const liveStatusOnly = process.argv.includes('--live-status-only');
  const allowMissingSandboxImage = process.argv.includes('--allow-missing-sandbox-image');
  const allowPendingEngineMachine = process.argv.includes('--allow-pending-engine-machine');
  const allowPendingCostOptimization = process.argv.includes('--allow-pending-cost-optimization');

  if (!Bun.which('flyctl')) {
    console.log('');
    console.log(
      status(
        'error',
        'flyctl not found on PATH (install from https://fly.io/docs/flyctl/install/, e.g. `brew install flyctl`)',
      ),
    );
    process.exit(1);
  }

  // Bun natively loads .env (and correctly handles double-quoted multiline
  // values like GITHUB_APP_PRIVATE_KEY and PROXY_CA_CERT) before this runs, so
  // process.env is already populated. We deliberately do not use the line-based
  // loadEnv helper here -- it cannot represent multiline secrets, and a
  // truncated value would pass the presence check while setting a broken secret.

  // Live status first: it needs only flyctl, not the secret values, so it works
  // even when the local .env is incomplete.
  const state = await gatherFlyState();
  printStatus(state);

  if (liveStatusOnly) {
    const failures = collectLiveStateFailures(state, {
      allowMissingSandboxImage,
      allowPendingEngineMachine,
      allowPendingCostOptimization,
    });
    if (failures.length > 0) {
      console.log(errorHeader('Live production invariant failures'));
      console.log('');
      for (const failure of failures) console.log(`  ${error('✗')} ${failure}`);
      console.log('');
      process.exit(1);
    }

    console.log(success('  Live Fly production invariants passed.'));
    console.log('');
    return;
  }

  // The plan is built from live state and is always useful, even with a partial
  // .env -- it shows which steps remain regardless of local configuration.
  printPlan(buildPlan(state));

  // Finally, validate the local environment. Missing values are a hard error
  // (you cannot run the secret-setting commands without them), so this gates the
  // exit code while leaving the status and plan above visible.
  const missing = validateLocalEnv();
  if (missing.length > 0) {
    printMissingEnv(missing);
    process.exit(1);
  }

  console.log(success('  Local deploy configuration is complete. Work through the plan above.'));
  console.log('');
}

if (import.meta.main) {
  run().catch((err) => {
    console.error(
      error(`Deploy manager failed: ${err instanceof Error ? err.message : String(err)}`),
    );
    process.exit(1);
  });
}
