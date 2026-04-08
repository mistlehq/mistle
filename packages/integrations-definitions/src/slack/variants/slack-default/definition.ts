import { SlackBaseDefinition, type SlackBaseIntegrationDefinition } from "./base-definition.js";
import { SlackWebhookSourceCapability } from "./webhook-source.server.js";
import { SlackWebhookHandler } from "./webhook.server.js";

export const SlackDefinition: SlackBaseIntegrationDefinition = {
  ...SlackBaseDefinition,
  webhookHandler: SlackWebhookHandler,
  webhookSource: SlackWebhookSourceCapability,
};
