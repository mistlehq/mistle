import {
  IntegrationConnectionMethodIds,
  IntegrationResourceSelectionModes,
  type IntegrationResourceCredentialRef,
  type IntegrationResourceCredentialSelectorInput,
  type IntegrationResourceDefinition,
  type IntegrationResourceSyncTrigger,
} from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema, GitHubCredentialSecretTypes } from "./auth.js";
import { GitHubCredentialResolverKeys } from "./credential-resolver-keys.js";

const GitHubRepositoryAppInstallationResourceCredential: IntegrationResourceCredentialRef = {
  secretType: GitHubCredentialSecretTypes.GITHUB_APP_INSTALLATION_TOKEN,
  resolverKey: GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN,
};

function resolveGitHubResourceCredential(input: {
  apiKeyCredential: IntegrationResourceCredentialRef;
  connection: IntegrationResourceCredentialSelectorInput["connection"];
}): IntegrationResourceCredentialRef {
  const parsedConnectionConfig = GitHubConnectionConfigSchema.parse(input.connection.config);

  if (
    parsedConnectionConfig.connection_method ===
    IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    return GitHubRepositoryAppInstallationResourceCredential;
  }

  return input.apiKeyCredential;
}

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
      credential: ({ connection }) =>
        resolveGitHubResourceCredential({
          apiKeyCredential: gitHubRepositoryApiKeyResourceCredential,
          connection,
        }),
    },
    {
      kind: "branch",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "branches",
      displayNameSingular: "branch",
      displayNamePlural: "branches",
      description: "Git branches accessible from repositories on this connection.",
      credential: ({ connection }) =>
        resolveGitHubResourceCredential({
          apiKeyCredential: gitHubRepositoryApiKeyResourceCredential,
          connection,
        }),
    },
    {
      kind: "user",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "users",
      displayNameSingular: "user",
      displayNamePlural: "users",
      description:
        "Human GitHub users with collaborator access to repositories on this connection.",
      credential: ({ connection }) =>
        resolveGitHubResourceCredential({
          apiKeyCredential: gitHubRepositoryApiKeyResourceCredential,
          connection,
        }),
    },
    {
      kind: "team",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "teams",
      displayNameSingular: "team",
      displayNamePlural: "teams",
      description: "GitHub teams discovered from organizations with accessible repositories.",
      credential: ({ connection }) =>
        resolveGitHubResourceCredential({
          apiKeyCredential: gitHubRepositoryApiKeyResourceCredential,
          connection,
        }),
    },
    {
      kind: "bot",
      selectionMode: IntegrationResourceSelectionModes.MULTI,
      bindingField: "bots",
      displayNameSingular: "GitHub App bot",
      displayNamePlural: "GitHub App bots",
      description:
        "GitHub App bots discovered from app installations in organizations with accessible repositories.",
      credential: ({ connection }) =>
        resolveGitHubResourceCredential({
          apiKeyCredential: gitHubRepositoryApiKeyResourceCredential,
          connection,
        }),
    },
  ];
}

export const GitHubResourceSyncTriggers: ReadonlyArray<IntegrationResourceSyncTrigger> = [
  {
    eventType: "github.installation_repositories.added",
    resourceKinds: ["repository", "user"],
  },
  {
    eventType: "github.installation_repositories.removed",
    resourceKinds: ["repository", "user"],
  },
  {
    eventType: "github.member.added",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.member.edited",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.member.removed",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.membership.added",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.membership.removed",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.organization.member_added",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.organization.member_removed",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.team.added_to_repository",
    resourceKinds: ["user"],
  },
  {
    eventType: "github.team.removed_from_repository",
    resourceKinds: ["user"],
  },
];
