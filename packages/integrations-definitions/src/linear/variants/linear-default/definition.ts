import { LinearBaseDefinition, type LinearBaseIntegrationDefinition } from "./base-definition.js";
import { AppendSessionLinkToLinearMcpMarkdownRequestMiddleware } from "./egress-request-middleware.server.js";
import { LinearIdentityLinkingCapability } from "./identity-linking.server.js";
import {
  LinearAuthorizationRevocationCapability,
  LinearOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";
import { resolveLinearUserAttributedEgressCredentialResolver } from "./user-attributed-egress.server.js";
import { LinearWebhookSourceCapability } from "./webhook-source.server.js";
import { LinearWebhookHandler } from "./webhook.server.js";

export const LinearDefinition: LinearBaseIntegrationDefinition = {
  ...LinearBaseDefinition,
  authorizationRevocation: LinearAuthorizationRevocationCapability,
  egressRequestMiddleware: [AppendSessionLinkToLinearMcpMarkdownRequestMiddleware],
  identityLinking: LinearIdentityLinkingCapability,
  oauth2AuthorizationCode: LinearOAuth2AuthorizationCodeCapability,
  resolveEgressCredentialResolver: resolveLinearUserAttributedEgressCredentialResolver,
  webhookHandler: LinearWebhookHandler,
  webhookSource: LinearWebhookSourceCapability,
};
