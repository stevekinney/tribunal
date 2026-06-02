import { App, type Octokit } from 'octokit';

export function createGithubApplication(appId: string, privateKeyRaw: string): App {
  const privateKey = privateKeyRaw.includes('\\n')
    ? privateKeyRaw.replace(/\\n/g, '\n')
    : privateKeyRaw;

  return new App({ appId, privateKey });
}

/**
 * Creates an environment-agnostic GitHub App singleton.
 *
 * The `getConfig` thunk is called lazily on first use, allowing callers to
 * defer environment access (e.g. `$env/dynamic/private` in SvelteKit,
 * `process.env` in Node workers).
 */
export function createGithubApplicationSingleton(
  getConfig: () => { appId: string; privateKey: string } | null,
) {
  let application: App | null = null;

  function getGithubApplication(): App | null {
    const config = getConfig();
    if (!config) return null;

    if (!application) {
      application = createGithubApplication(config.appId, config.privateKey);
    }

    return application;
  }

  async function getInstallationOctokit(installationId: number): Promise<Octokit | null> {
    const github = getGithubApplication();
    if (!github) return null;

    return github.getInstallationOctokit(installationId);
  }

  function resetGithubApplication(): void {
    application = null;
  }

  return {
    getGithubApplication,
    getInstallationOctokit,
    resetGithubApplication,
  };
}
