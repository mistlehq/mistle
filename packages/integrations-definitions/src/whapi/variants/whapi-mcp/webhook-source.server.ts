import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import { WhapiConnectionConfigSchema, type WhapiConnectionConfig } from "./auth.js";
import type { WhapiTargetConfig } from "./target-config-schema.js";

export const WhapiWebhookSourceCapability: IntegrationWebhookSourceCapability<
  WhapiTargetConfig,
  Record<string, never>,
  WhapiConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  supportsConnection(input) {
    return WhapiConnectionConfigSchema.safeParse(input.connection.config).success;
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Whapi webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Whapi webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
};
