import {
  IntegrationConnectionMethodIds,
  IntegrationResourceSelectionModes,
  type IntegrationResourceCredentialRef,
  type IntegrationResourceDefinition,
  type IntegrationResourceSyncTrigger,
} from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema, GitHubCredentialSecretTypes } from "./auth.js";
import { GitHubCredentialResolverKeys } from "./credential-resolver-keys.js";

const GitHubRepositoryAppInstallationResourceCredential: IntegrationResourceCredentialRef = {
  secretType: GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN,
  resolverKey: GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN,
};

export function createGitHubResourceDefinitions(input: {
  apiKeySlotKey: string;
}): ReadonlyArray<IntegrationResourceDefinition> {
  const gitHubRepositoryApiKeyResourceCredential: IntegrationResourceCredentialRef = {
    secretType: GitHubCredentialSecretTypes.API_KEY,
    slotKey: input.apiKeySlotKey,
  };

  return [
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

        return gitHubRepositoryApiKeyResourceCredential;
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

        return gitHubRepositoryApiKeyResourceCredential;
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

        return gitHubRepositoryApiKeyResourceCredential;
      },
    },
    {
      kind: "team",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "teams",
      displayNameSingular: "team",
      displayNamePlural: "teams",
      description: "GitHub teams discovered from organizations with accessible repositories.",
      credential: ({ connection }) => {
        const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(connection.config);

        if (
          parsedConnectionConfig.connection_method ===
          IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
        ) {
          return GitHubRepositoryAppInstallationResourceCredential;
        }

        return gitHubRepositoryApiKeyResourceCredential;
      },
    },
  ];
}

export const GitHubResourceSyncTriggers: ReadonlyArray<IntegrationResourceSyncTrigger> = [
  {
    eventType: "github.installation_repositories.added",
    resourceKinds: ["repository", "team"],
  },
  {
    eventType: "github.installation_repositories.removed",
    resourceKinds: ["repository", "team"],
  },
];
