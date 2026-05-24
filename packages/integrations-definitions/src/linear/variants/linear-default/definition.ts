import { LinearBaseDefinition, type LinearBaseIntegrationDefinition } from "./base-definition.js";
import { AppendSessionLinkToLinearMcpMarkdownRequestMiddleware } from "./egress-request-middleware.server.js";
import { LinearWebhookSourceCapability } from "./webhook-source.server.js";
import { LinearWebhookHandler } from "./webhook.server.js";

export const LinearDefinition: LinearBaseIntegrationDefinition = {
  ...LinearBaseDefinition,
  egressRequestMiddleware: [AppendSessionLinkToLinearMcpMarkdownRequestMiddleware],
  webhookHandler: LinearWebhookHandler,
  webhookSource: LinearWebhookSourceCapability,
};
