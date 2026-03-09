import {
  IntegrationResourceSelectionModes,
  type IntegrationResourceCredentialRef,
  type IntegrationResourceDefinition,
  type IntegrationResourceSyncTrigger,
  IntegrationSupportedAuthSchemes,
} from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema, GitHubCredentialSecretTypes } from "./auth.js";
import { GitHubCredentialResolverKeys } from "./credential-resolver.js";

const GitHubRepositoryOAuthResourceCredential: IntegrationResourceCredentialRef = {
  secretType: GitHubCredentialSecretTypes.OAUTH_ACCESS_TOKEN,
  purpose: "list-resources",
  resolverKey: GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN,
};

const GitHubRepositoryApiKeyResourceCredential: IntegrationResourceCredentialRef = {
  secretType: GitHubCredentialSecretTypes.API_KEY,
  purpose: "api_key",
};

export const GitHubResourceDefinitions: ReadonlyArray<IntegrationResourceDefinition> = [
  {
    kind: "repository",
    selectionMode: IntegrationResourceSelectionModes.MULTI,
    bindingField: "repositories",
    displayNameSingular: "repository",
    displayNamePlural: "repositories",
    description: "GitHub repositories accessible to this connection.",
    credential: ({ connection }) => {
      const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(connection.config);

      if (parsedConnectionConfig.auth_scheme === IntegrationSupportedAuthSchemes.OAUTH) {
        return GitHubRepositoryOAuthResourceCredential;
      }

      return GitHubRepositoryApiKeyResourceCredential;
    },
  },
];

export const GitHubResourceSyncTriggers: ReadonlyArray<IntegrationResourceSyncTrigger> = [
  {
    eventType: "github.installation_repositories.added",
    resourceKinds: ["repository"],
  },
  {
    eventType: "github.installation_repositories.removed",
    resourceKinds: ["repository"],
  },
];
