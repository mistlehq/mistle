import {
  WhapiMcpBaseDefinition,
  type WhapiMcpBaseIntegrationDefinition,
} from "./base-definition.js";
import { WhapiWebhookSourceCapability } from "./webhook-source.server.js";
import { WhapiWebhookHandler } from "./webhook.server.js";

export const WhapiDefinition: WhapiMcpBaseIntegrationDefinition = {
  ...WhapiMcpBaseDefinition,
  webhookHandler: WhapiWebhookHandler,
  webhookSource: WhapiWebhookSourceCapability,
};
