import type {
  IntegrationFormConnectionResourceSummary,
  IntegrationFormContext,
  ResolvedIntegrationForm,
} from "@mistle/integrations-core";

import { GitHubToolIds } from "./tool-ids.js";

type GitHubBindingFormContext = IntegrationFormContext;

function resolveRepositoryResourceSummary(
  input: GitHubBindingFormContext,
): IntegrationFormConnectionResourceSummary | undefined {
  return input.connection?.resources?.find((resource) => resource.kind === "repository");
}

export function resolveGitHubBindingConfigForm(
  input: GitHubBindingFormContext,
): ResolvedIntegrationForm {
  const connectionId = input.connection?.id;
  if (connectionId === undefined) {
    throw new Error("GitHub binding form requires connection context.");
  }

  const repositoryResourceSummary = resolveRepositoryResourceSummary(input);

  return {
    schema: {
      properties: {
        repositories: {
          title: "Repositories",
          default: [],
        },
        tools: {
          title: "Tools",
          default: [],
          items: {
            type: "string",
            enum: [GitHubToolIds.GITHUB_CLI],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    },
    uiSchema: {
      repositories: {
        "ui:widget": "integration-resource-string-array",
        "ui:options": {
          connectionId,
          kind: "repository",
          title: "Repositories",
          searchPlaceholder: "Search repositories",
          emptyMessage: "No repositories available for this connection.",
          refreshLabel: "Refresh repositories",
          ...(repositoryResourceSummary === undefined
            ? {}
            : {
                resourceSummary: {
                  kind: repositoryResourceSummary.kind,
                  selectionMode: repositoryResourceSummary.selectionMode,
                  count: repositoryResourceSummary.count,
                  syncState: repositoryResourceSummary.syncState,
                  ...(repositoryResourceSummary.lastSyncedAt === undefined
                    ? {}
                    : { lastSyncedAt: repositoryResourceSummary.lastSyncedAt }),
                },
              }),
        },
      },
      tools: {
        "ui:enumNames": ["GitHub CLI"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
        },
      },
    },
  };
}
