import { GitHubCredentialResolverKeys } from "../../shared/credential-resolver-keys.js";
import { GitHubAppInstallationCredentialResolver } from "../../shared/credential-resolver.server.js";
import { GitHubAppInstallationRedirectHandler } from "../../shared/github-app-installation-handler.server.js";
import { listGitHubConnectionResources } from "../../shared/list-connection-resources.server.js";
import {
  createGitHubResourceDefinitions,
  GitHubResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
import { GitHubCredentialSlotKeys } from "../../shared/slot-keys.js";
import { GitHubWebhookSourceCapability } from "../../shared/webhook-source.server.js";
import {
  GitHubCloudBaseDefinition,
  type GitHubCloudBaseIntegrationDefinition,
} from "./base-definition.js";
import { GitHubCloudWebhookHandler } from "./webhook.server.js";

export const GitHubCloudDefinition: GitHubCloudBaseIntegrationDefinition = {
  ...GitHubCloudBaseDefinition,
  credentialResolvers: {
    custom: {
      [GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN]:
        GitHubAppInstallationCredentialResolver,
    },
  },
  redirectHandler: GitHubAppInstallationRedirectHandler,
  webhookHandler: GitHubCloudWebhookHandler,
  webhookSource: GitHubWebhookSourceCapability,
  resourceDefinitions: createGitHubResourceDefinitions({
    apiKeySlotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
  }),
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
};
