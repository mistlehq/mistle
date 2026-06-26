import {
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
  type IntegrationProviderConfigurationSetupCapability,
} from "@mistle/integrations-core";

import { DiscordConnectionMethodId, type DiscordConnectionConfig } from "./auth.js";
import {
  DiscordGatewayPermissionRequirements,
  DiscordSupportedWebhookEvents,
} from "./supported-webhook-events.js";
import type { DiscordTargetConfig } from "./target-config-schema.js";

const DiscordGatewayIntentCapabilities = [
  DiscordGatewayPermissionRequirements.GUILD_MESSAGES,
  DiscordGatewayPermissionRequirements.GUILD_MESSAGE_REACTIONS,
  DiscordGatewayPermissionRequirements.MESSAGE_CONTENT,
];

export const DiscordProviderConfigurationSetupCapability: IntegrationProviderConfigurationSetupCapability<
  DiscordTargetConfig,
  Record<string, string>,
  DiscordConnectionConfig
> = {
  flows: [
    {
      methodId: DiscordConnectionMethodId,
      requiresWebhookCallbackUrl: true,
      routeSegment: "provider-configuration",
      complete(input) {
        const botToken = input.connectionSecrets.botToken;
        if (botToken === undefined || botToken.trim().length === 0) {
          throw new Error("Discord setup requires a bot token.");
        }

        const publicKey = input.connectionSecrets.publicKey;
        if (publicKey === undefined || publicKey.trim().length === 0) {
          throw new Error("Discord setup requires an application public key.");
        }

        if (input.webhookCallbackUrl === undefined) {
          throw new Error(
            `Discord provider configuration setup for connection '${input.connection.id}' requires a callback URL.`,
          );
        }

        return {
          webhookSource: {
            providerMetadata: {
              [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
                events: DiscordSupportedWebhookEvents.map((event) => event.providerEventType),
                permissions: DiscordGatewayIntentCapabilities,
              },
            },
          },
        };
      },
    },
  ],
};
