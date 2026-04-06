import {
  IntegrationWebhookSourceLifecycles,
  IntegrationWebhookSourceOwnerScopes,
  IntegrationWebhookSourceRoutingStrategies,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import type { GitHubConnectionConfig } from "./auth.js";
import type { GitHubTargetConfig } from "./target-config-schema.js";
import type { GitHubTargetSecrets } from "./target-secret-schema.js";

export const GitHubWebhookSourceCapability: IntegrationWebhookSourceCapability<
  GitHubTargetConfig,
  GitHubTargetSecrets,
  GitHubConnectionConfig
> = {
  ownerScope: IntegrationWebhookSourceOwnerScopes.TARGET,
  routingStrategy: IntegrationWebhookSourceRoutingStrategies.PAYLOAD,
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  async describeSource(input) {
    return {
      displayName: input.source.displayName ?? "GitHub App webhook",
      callbackUrl: `${input.controlPlaneBaseUrl}/v1/integration/webhooks/${input.targetKey}`,
      providerMetadata: input.source.providerMetadata,
    };
  },
};
