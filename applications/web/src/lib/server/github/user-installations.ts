import type { Endpoints } from '@octokit/types';

type UserInstallation =
  Endpoints['GET /user/installations']['response']['data']['installations'][number];

export interface UserInstallationClient {
  request(
    endpoint: 'GET /user/installations',
    options: { per_page: number; page: number },
  ): Promise<{ data: { installations: UserInstallation[] } }>;
}

export async function listUserInstallations(
  octokit: UserInstallationClient,
): Promise<UserInstallation[]> {
  const installations: UserInstallation[] = [];
  let page = 1;

  while (true) {
    const { data } = await octokit.request('GET /user/installations', {
      per_page: 100,
      page,
    });

    installations.push(...data.installations);

    if (data.installations.length < 100) break;
    page += 1;
  }

  return installations;
}

export function getSingleInstallationConfigurationUrl(
  installations: UserInstallation[],
  applicationSlug: string,
): string | null {
  const matchingInstallationUrls = installations
    .filter((installation) => installation.app_slug === applicationSlug)
    .map((installation) => installation.html_url)
    .filter((url): url is string => Boolean(url));

  return matchingInstallationUrls.length === 1 ? matchingInstallationUrls[0] : null;
}

export function userHasInstallationAccess(
  installations: UserInstallation[],
  installationId: number,
): boolean {
  return installations.some((installation) => installation.id === installationId);
}
