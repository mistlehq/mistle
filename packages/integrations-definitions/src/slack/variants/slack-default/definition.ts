import { listSlackConnectionResources } from "../../shared/list-connection-resources.server.js";
import {
  createSlackResourceDefinitions,
  SlackResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
import { SlackBaseDefinition, type SlackBaseIntegrationDefinition } from "./base-definition.js";
import { AppendSessionLinkToSlackTextRequestMiddleware } from "./egress-request-middleware.server.js";
import { SlackIdentityLinkingCapability } from "./identity-linking.server.js";
import { SlackProviderAppSetupCapability } from "./provider-app-setup.server.js";
import { SlackWebhookSourceCapability } from "./webhook-source.server.js";
import { SlackWebhookHandler } from "./webhook.server.js";

export const SlackDefinition: SlackBaseIntegrationDefinition = {
  ...SlackBaseDefinition,
  identityLinking: SlackIdentityLinkingCapability,
  providerAppSetup: SlackProviderAppSetupCapability,
  egressRequestMiddleware: [AppendSessionLinkToSlackTextRequestMiddleware],
  webhookHandler: SlackWebhookHandler,
  webhookSource: SlackWebhookSourceCapability,
  resourceDefinitions: createSlackResourceDefinitions(),
  resourceSyncTriggers: SlackResourceSyncTriggers,
  listConnectionResources: listSlackConnectionResources,
};
