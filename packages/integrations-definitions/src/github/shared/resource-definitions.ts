import {
  IntegrationConnectionMethodIds,
  IntegrationResourceSelectionModes,
  type IntegrationResourceCredentialRef,
  type IntegrationResourceDefinition,
  type IntegrationResourceSyncTrigger,
} from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema, GitHubCredentialSecretTypes } from "./auth.js";
import { GitHubCredentialResolverKeys } from "./credential-resolver.js";

const GitHubRepositoryAppInstallationResourceCredential: IntegrationResourceCredentialRef = {
  secretType: GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN,
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

      if (
        parsedConnectionConfig.connection_method ===
        IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
      ) {
        return GitHubRepositoryAppInstallationResourceCredential;
      }

      return GitHubRepositoryApiKeyResourceCredential;
    },
  },
  {
    kind: "branch",
    selectionMode: IntegrationResourceSelectionModes.MULTI,
    bindingField: "branches",
    displayNameSingular: "branch",
    displayNamePlural: "branches",
    description: "Git branches accessible from repositories on this connection.",
    credential: ({ connection }) => {
      const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(connection.config);

      if (
        parsedConnectionConfig.connection_method ===
        IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
      ) {
        return GitHubRepositoryAppInstallationResourceCredential;
      }

      return GitHubRepositoryApiKeyResourceCredential;
    },
  },
  {
    kind: "user",
    selectionMode: IntegrationResourceSelectionModes.MULTI,
    bindingField: "users",
    displayNameSingular: "user",
    displayNamePlural: "users",
    description: "GitHub users discovered from accessible repositories on this connection.",
    credential: ({ connection }) => {
      const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(connection.config);

      if (
        parsedConnectionConfig.connection_method ===
        IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
      ) {
        return GitHubRepositoryAppInstallationResourceCredential;
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
