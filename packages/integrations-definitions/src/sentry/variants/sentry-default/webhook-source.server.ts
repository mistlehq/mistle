import {
  IntegrationWebhookSourceLifecycles,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import {
  SentryWebhookSigningSecretConnectionConfigSchema,
  type SentryConnectionConfig,
} from "./auth.js";

export const SentryWebhookSourceCapability: IntegrationWebhookSourceCapability<
  Record<string, never>,
  Record<string, never>,
  SentryConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.IMPLICIT,
  supportsConnection(input) {
    return SentryWebhookSigningSecretConnectionConfigSchema.safeParse(input.connection.config)
      .success;
  },
  describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Sentry webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Sentry issue webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: {
        ...input.source.providerMetadata,
        [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
          events: ["issue"],
        },
      },
    };
  },
};
