import { JiraBaseDefinition, type JiraBaseIntegrationDefinition } from "./base-definition.js";
import { exchangeJiraClientCredentials } from "./oauth2-client-credentials.server.js";
import { JiraWebhookSourceCapability } from "./webhook-source.server.js";
import { JiraWebhookHandler } from "./webhook.server.js";

export const JiraDefinition: JiraBaseIntegrationDefinition = {
  ...JiraBaseDefinition,
  oauth2ClientCredentials: {
    exchangeClientCredentials: exchangeJiraClientCredentials,
  },
  webhookHandler: JiraWebhookHandler,
  webhookSource: JiraWebhookSourceCapability,
};
