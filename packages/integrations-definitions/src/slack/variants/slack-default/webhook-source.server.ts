import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import type { SlackConnectionConfig } from "./auth.js";
import type { SlackTargetConfig } from "./target-config-schema.js";
import type { SlackTargetSecrets } from "./target-secret-schema.js";

export function buildSlackWebhookCallbackUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
  endpointKey: string;
}): string {
  return `${input.controlPlaneBaseUrl}/v1/integration/webhooks/${input.targetKey}/${input.endpointKey}`;
}

export const SlackWebhookSourceCapability: IntegrationWebhookSourceCapability<
  SlackTargetConfig,
  SlackTargetSecrets,
  SlackConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Slack webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Slack Events API webhook",
      callbackUrl: buildSlackWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
};
