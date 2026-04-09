import { GitHubCredentialResolverKeys } from "../../shared/credential-resolver-keys.js";
import { GitHubAppInstallationCredentialResolver } from "../../shared/credential-resolver.server.js";
import { listGitHubConnectionResources } from "../../shared/list-connection-resources.server.js";
import {
  createGitHubResourceDefinitions,
  GitHubResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
import { GitHubCredentialSlotKeys } from "../../shared/slot-keys.js";
import { GitHubWebhookSourceCapability } from "../../shared/webhook-source.server.js";
import {
  GitHubEnterpriseServerBaseDefinition,
  type GitHubEnterpriseServerBaseIntegrationDefinition,
} from "./base-definition.js";
import { GitHubEnterpriseServerWebhookHandler } from "./webhook.server.js";

export const GitHubEnterpriseServerDefinition: GitHubEnterpriseServerBaseIntegrationDefinition = {
  ...GitHubEnterpriseServerBaseDefinition,
  credentialResolvers: {
    custom: {
      [GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN]:
        GitHubAppInstallationCredentialResolver,
    },
  },
  webhookHandler: GitHubEnterpriseServerWebhookHandler,
  webhookSource: GitHubWebhookSourceCapability,
  resourceDefinitions: createGitHubResourceDefinitions({
    apiKeySlotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_API_KEY,
  }),
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
};
