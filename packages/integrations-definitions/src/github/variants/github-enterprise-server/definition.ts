import { GitHubCredentialResolverKeys } from "../../shared/credential-resolver-keys.js";
import { GitHubAppInstallationCredentialResolver } from "../../shared/credential-resolver.server.js";
import { GitHubAppInstallationRedirectHandler } from "../../shared/github-app-installation-handler.server.js";
import { listGitHubConnectionResources } from "../../shared/list-connection-resources.server.js";
import {
  GitHubResourceDefinitions,
  GitHubResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
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
  redirectHandler: GitHubAppInstallationRedirectHandler,
  webhookHandler: GitHubEnterpriseServerWebhookHandler,
  webhookSource: GitHubWebhookSourceCapability,
  resourceDefinitions: GitHubResourceDefinitions,
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
};
