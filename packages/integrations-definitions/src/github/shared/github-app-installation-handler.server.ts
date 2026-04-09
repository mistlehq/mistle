import {
  IntegrationConnectionMethodIds,
  type IntegrationRedirectHandler,
} from "@mistle/integrations-core";

import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

function resolveGitHubAppSlug(targetConfig: GitHubTargetConfig): string {
  if (targetConfig.appSlug === undefined || targetConfig.appSlug.length === 0) {
    throw new Error("GitHub App installation flow requires `app_slug` in target config.");
  }

  return targetConfig.appSlug;
}

function resolveGitHubAppId(targetConfig: GitHubTargetConfig): string {
  if (targetConfig.appId === undefined || targetConfig.appId.length === 0) {
    throw new Error("GitHub App installation flow requires `app_id` in target config.");
  }

  return targetConfig.appId;
}

function createGitHubAppInstallUrl(input: {
  webBaseUrl: string;
  appSlug: string;
  state: string;
}): string {
  const installUrl = new URL(`/apps/${input.appSlug}/installations/new`, input.webBaseUrl);
  installUrl.searchParams.set("state", input.state);
  return installUrl.toString();
}

function resolveInstallationId(query: URLSearchParams): string {
  const installationId = query.get("installation_id");

  if (installationId === null || installationId.length === 0) {
    throw new Error("GitHub App installation callback is missing `installation_id`.");
  }

  return installationId;
}

export const GitHubAppInstallationRedirectHandler: IntegrationRedirectHandler<
  GitHubTargetConfig,
  GitHubTargetSecrets
> = {
  start(input) {
    const appSlug = resolveGitHubAppSlug(input.target.config);

    return {
      authorizationUrl: createGitHubAppInstallUrl({
        webBaseUrl: input.target.config.webBaseUrl,
        appSlug,
        state: input.state,
      }),
    };
  },
  complete(input) {
    const installationId = resolveInstallationId(input.query);
    const setupAction = input.query.get("setup_action");
    const appId = resolveGitHubAppId(input.target.config);
    const appSlug = resolveGitHubAppSlug(input.target.config);

    return {
      externalSubjectId: installationId,
      connectionConfig: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        app_id: appId,
        app_slug: appSlug,
        installation_id: installationId,
        ...(setupAction === null ? {} : { setup_action: setupAction }),
      },
      credentialMaterials: [],
    };
  },
};
