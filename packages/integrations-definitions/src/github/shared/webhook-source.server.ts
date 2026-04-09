import {
  IntegrationConnectionMethodIds,
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import type { GitHubConnectionConfig } from "./auth.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

function isGitHubAppInstallationConnection(connection: GitHubConnectionConfig): boolean {
  return connection.connection_method === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION;
}

export function buildGitHubWebhookCallbackUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
  endpointKey: string;
}): string {
  return `${input.controlPlaneBaseUrl}/v1/integration/webhooks/${input.targetKey}/${input.endpointKey}`;
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
      callbackUrl: buildGitHubWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
};
