import {
  WasenderApiBaseDefinition,
  type WasenderApiBaseIntegrationDefinition,
} from "./base-definition.js";
import { WasenderApiProviderConfigurationSetupCapability } from "./provider-configuration-setup.server.js";
import { WasenderApiWebhookSourceCapability } from "./webhook-source.server.js";
import { WasenderApiWebhookHandler } from "./webhook.server.js";

export const WasenderApiDefinition: WasenderApiBaseIntegrationDefinition = {
  ...WasenderApiBaseDefinition,
  webhookAcceptedResponse: {
    status: 200,
    body: {
      received: true,
    },
  },
  providerConfigurationSetup: WasenderApiProviderConfigurationSetupCapability,
  webhookHandler: WasenderApiWebhookHandler,
  webhookSource: WasenderApiWebhookSourceCapability,
};
