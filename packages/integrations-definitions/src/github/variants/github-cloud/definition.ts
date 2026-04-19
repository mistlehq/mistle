import { GitHubCredentialResolverKeys } from "../../shared/credential-resolver-keys.js";
import { GitHubAppInstallationCredentialResolver } from "../../shared/credential-resolver.server.js";
import { AppendSessionLinkToGitHubMarkdownRequestMiddleware } from "../../shared/egress-request-middleware.server.js";
import { GitHubIdentityLinkingCapability } from "../../shared/identity-linking.server.js";
import { listGitHubConnectionResources } from "../../shared/list-connection-resources.server.js";
import {
  createGitHubResourceDefinitions,
  GitHubResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
import { GitHubCredentialSlotKeys } from "../../shared/slot-keys.js";
import { resolveGitHubUserAttributedEgressCredentialResolver } from "../../shared/user-attributed-egress.server.js";
import { GitHubWebhookSourceCapability } from "../../shared/webhook-source.server.js";
import {
  GitHubCloudBaseDefinition,
  type GitHubCloudBaseIntegrationDefinition,
} from "./base-definition.js";
import { GitHubCloudWebhookHandler } from "./webhook.server.js";

export const GitHubCloudDefinition: GitHubCloudBaseIntegrationDefinition = {
  ...GitHubCloudBaseDefinition,
  identityLinking: GitHubIdentityLinkingCapability,
  egressRequestMiddleware: [AppendSessionLinkToGitHubMarkdownRequestMiddleware],
  resolveEgressCredentialResolver: resolveGitHubUserAttributedEgressCredentialResolver,
  credentialResolvers: {
    custom: {
      [GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN]:
        GitHubAppInstallationCredentialResolver,
    },
  },
  webhookHandler: GitHubCloudWebhookHandler,
  webhookSource: GitHubWebhookSourceCapability,
  resourceDefinitions: createGitHubResourceDefinitions({
    apiKeySlotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
  }),
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
};
