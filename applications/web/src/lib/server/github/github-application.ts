import { env } from '$env/dynamic/private';
import { createGithubApplication, createGithubApplicationSingleton } from '@tribunal/github';

export { createGithubApplication };

const github = createGithubApplicationSingleton(() => {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return null;
  return { appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_APP_PRIVATE_KEY };
});

export const { getGithubApplication, getInstallationOctokit, resetGithubApplication } = github;
