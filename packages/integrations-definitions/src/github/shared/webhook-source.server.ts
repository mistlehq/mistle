import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import { buildIntegrationWebhookCallbackUrl } from "../../shared/webhook-callback-url.server.js";
import type { GitHubConnectionConfig } from "./auth.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

function isGitHubAppInstallationConnection(connection: GitHubConnectionConfig): boolean {
  return connection.connection_method === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION;
}

export const GitHubWebhookSourceCapability: IntegrationWebhookSourceCapability<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  supportsConnection(input) {
    return isGitHubAppInstallationConnection(input.connection.config);
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`GitHub webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "GitHub App webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
};
