import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import { WasenderApiConnectionConfigSchema, type WasenderApiConnectionConfig } from "./auth.js";
import type { WasenderApiTargetConfig } from "./target-config-schema.js";

export const WasenderApiWebhookSourceCapability: IntegrationWebhookSourceCapability<
  WasenderApiTargetConfig,
  Record<string, never>,
  WasenderApiConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  supportsConnection(input) {
    return WasenderApiConnectionConfigSchema.safeParse(input.connection.config).success;
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`WasenderAPI webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "WasenderAPI webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
};
