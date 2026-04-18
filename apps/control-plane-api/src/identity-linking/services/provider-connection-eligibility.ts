import type { IntegrationConnection } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  GitHubCredentialSlotKeys,
  parseGitHubAppInstallationConnectionConfig,
} from "@mistle/integrations-definitions";

import type { IdentityLinkProviderMetadata } from "./provider-metadata.js";

export function isConnectionEligibleForIdentityLinkProvider(input: {
  provider: IdentityLinkProviderMetadata;
  connection: Pick<IntegrationConnection, "config">;
  credentialSlotKeys: ReadonlySet<string>;
}): boolean {
  if (input.provider.providerFamily !== "github") {
    return true;
  }

  const parsedConnectionMethod = input.connection.config?.["connection_method"];
  if (parsedConnectionMethod !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION) {
    return false;
  }

  try {
    const connectionConfig = parseGitHubAppInstallationConnectionConfig(input.connection.config);
    const clientId = connectionConfig.client_id?.trim();
    if (clientId === undefined || clientId.length === 0) {
      return false;
    }
  } catch {
    return false;
  }

  return input.credentialSlotKeys.has(GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET);
}
