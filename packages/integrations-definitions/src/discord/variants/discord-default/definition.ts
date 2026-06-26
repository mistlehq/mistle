import { listDiscordConnectionResources } from "../../shared/list-connection-resources.server.js";
import {
  createDiscordResourceDefinitions,
  DiscordResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
import { DiscordBaseDefinition, type DiscordBaseIntegrationDefinition } from "./base-definition.js";
import { DiscordProviderConfigurationSetupCapability } from "./provider-configuration-setup.server.js";
import { DiscordWebhookSourceCapability } from "./webhook-source.server.js";
import { DiscordWebhookHandler } from "./webhook.server.js";

export const DiscordDefinition: DiscordBaseIntegrationDefinition = {
  ...DiscordBaseDefinition,
  providerConfigurationSetup: DiscordProviderConfigurationSetupCapability,
  webhookAcceptedResponse: {
    status: 204,
  },
  webhookHandler: DiscordWebhookHandler,
  webhookSource: DiscordWebhookSourceCapability,
  resourceDefinitions: createDiscordResourceDefinitions(),
  resourceSyncTriggers: DiscordResourceSyncTriggers,
  listConnectionResources: listDiscordConnectionResources,
};
