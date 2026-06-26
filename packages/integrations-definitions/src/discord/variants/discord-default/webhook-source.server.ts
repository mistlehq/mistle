import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import { DiscordConnectionConfigSchema, type DiscordConnectionConfig } from "./auth.js";
import type { DiscordTargetConfig } from "./target-config-schema.js";

export const DiscordWebhookSourceCapability: IntegrationWebhookSourceCapability<
  DiscordTargetConfig,
  Record<string, never>,
  DiscordConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  supportsConnection(input) {
    return DiscordConnectionConfigSchema.safeParse(input.connection.config).success;
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Discord webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Discord webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
};
