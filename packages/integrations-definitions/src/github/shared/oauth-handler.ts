import {
  IntegrationSupportedAuthSchemes,
  type IntegrationOAuthHandler,
} from "@mistle/integrations-core";

import type { GitHubTargetConfig } from "./target-config-schema.js";

function resolveGitHubAppSlug(targetConfig: GitHubTargetConfig): string {
  if (targetConfig.appSlug === undefined || targetConfig.appSlug.length === 0) {
    throw new Error("GitHub App OAuth flow requires `app_slug` in target config.");
  }

  return targetConfig.appSlug;
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
    throw new Error("GitHub App OAuth callback is missing `installation_id`.");
  }

  return installationId;
}

export const GitHubAppOAuthHandler: IntegrationOAuthHandler<GitHubTargetConfig> = {
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

    return {
      externalSubjectId: installationId,
      connectionConfig: {
        auth_scheme: IntegrationSupportedAuthSchemes.OAUTH,
        installation_id: installationId,
        ...(setupAction === null ? {} : { setup_action: setupAction }),
      },
      credentialMaterials: [],
    };
  },
};
