import {
  WhapiMcpBaseDefinition,
  type WhapiMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { WhapiProviderConfigurationSetupCapability } from "./provider-configuration-setup.server.js";
import { WhapiWebhookSourceCapability } from "./webhook-source.server.js";
import { WhapiWebhookHandler } from "./webhook.server.js";

export const WhapiDefinition: WhapiMcpBaseIntegrationDefinition = {
  ...WhapiMcpBaseDefinition,
  providerConfigurationSetup: WhapiProviderConfigurationSetupCapability,
  webhookHandler: WhapiWebhookHandler,
  webhookSource: WhapiWebhookSourceCapability,
};
