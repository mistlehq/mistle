import {
  IntegrationWebhookSourceLifecycles,
  type IntegrationWebhookSourceCapability,
} from "@mistle/integrations-core";
import { z } from "zod";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import { WhapiConnectionConfigSchema, type WhapiConnectionConfig } from "./auth.js";
import {
  buildWhapiWebhookTriggerCapabilitiesProviderMetadata,
  loadWhapiChannelSettings,
} from "./channel-settings.server.js";
import { WhapiApiBaseUrl } from "./target-config-schema.js";
import type { WhapiTargetConfig } from "./target-config-schema.js";

const WhapiWebhookTriggerCapabilitiesRefreshBodySchema = z.object({}).strict();

function resolveWhapiApiToken(input: {
  connectionId: string;
  connectionSecrets: Record<string, string> | undefined;
}): string {
  const apiToken = input.connectionSecrets?.["apiToken"]?.trim();
  if (apiToken === undefined || apiToken.length === 0) {
    throw new Error(`Integration connection '${input.connectionId}' is missing Whapi API token.`);
  }

  return apiToken;
}

function buildWhapiCallbackUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
  endpointKey: string;
}): string {
  return buildIntegrationWebhookCallbackUrl({
    controlPlaneBaseUrl: input.controlPlaneBaseUrl,
    targetKey: input.targetKey,
    endpointKey: input.endpointKey,
  });
}

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
      callbackUrl: buildWhapiCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
  async refreshTriggerCapabilities(input) {
    WhapiWebhookTriggerCapabilitiesRefreshBodySchema.parse(input.body);

    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Whapi webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      providerMetadata: buildWhapiWebhookTriggerCapabilitiesProviderMetadata({
        settingsJson: await loadWhapiChannelSettings({
          apiBaseUrl: WhapiApiBaseUrl,
          apiToken: resolveWhapiApiToken({
            connectionId: input.connection.id,
            connectionSecrets: input.connectionSecrets,
          }),
        }),
        webhookCallbackUrl: buildWhapiCallbackUrl({
          controlPlaneBaseUrl: input.controlPlaneBaseUrl,
          targetKey: input.targetKey,
          endpointKey,
        }),
      }),
    };
  },
};
