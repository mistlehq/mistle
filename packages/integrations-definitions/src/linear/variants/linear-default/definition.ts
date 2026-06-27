import { LinearBaseDefinition, type LinearBaseIntegrationDefinition } from "./base-definition.js";
import { AppendSessionLinkToLinearMcpMarkdownRequestMiddleware } from "./egress-request-middleware.server.js";
import {
  LinearAuthorizationRevocationCapability,
  LinearOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";
import { LinearWebhookSourceCapability } from "./webhook-source.server.js";
import { LinearWebhookHandler } from "./webhook.server.js";

export const LinearDefinition: LinearBaseIntegrationDefinition = {
  ...LinearBaseDefinition,
  authorizationRevocation: LinearAuthorizationRevocationCapability,
  egressRequestMiddleware: [AppendSessionLinkToLinearMcpMarkdownRequestMiddleware],
  oauth2AuthorizationCode: LinearOAuth2AuthorizationCodeCapability,
  webhookHandler: LinearWebhookHandler,
  webhookSource: LinearWebhookSourceCapability,
};
