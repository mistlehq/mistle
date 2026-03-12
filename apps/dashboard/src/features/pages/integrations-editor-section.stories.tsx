import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import {
  createGithubRepositoryResources,
  filterRepositoryItems,
  RepositoryItems,
  resolveRepositorySearchTerms,
} from "../forms/integration-resource-string-array-widget-story-support.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { IntegrationsEditorSection } from "./sandbox-profile-editor-page.js";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

const OpenAiTarget: IntegrationTargetSummary = {
  targetKey: "target-openai",
  displayName: "OpenAI",
  familyId: "openai",
  variantId: "openai-default",
  config: {
    api_base_url: "https://api.openai.com",
    binding_capabilities: createOpenAiRawBindingCapabilities(),
  },
  targetHealth: {
    configStatus: "valid",
  },
};

const OpenAiConnection: IntegrationConnectionSummary = {
  id: "connection-openai",
  displayName: "Primary OpenAI Workspace",
  targetKey: OpenAiTarget.targetKey,
  status: "active",
  config: {
    auth_scheme: "api-key",
  },
};

const GithubTarget: IntegrationTargetSummary = {
  targetKey: "target-github",
  displayName: "GitHub",
  familyId: "github",
  variantId: "github-cloud",
  config: {
    api_base_url: "https://api.github.com",
    web_base_url: "https://github.com",
  },
  targetHealth: {
    configStatus: "valid",
  },
};

const GithubConnection: IntegrationConnectionSummary = {
  id: "connection-github",
  displayName: "GitHub Production",
  targetKey: GithubTarget.targetKey,
  status: "active",
  resources: [
    {
      kind: "repository",
      selectionMode: "multi",
      count: 24,
      syncState: "ready",
      lastSyncedAt: "2026-03-09T12:00:00.000Z",
    },
  ],
  config: {
    auth_scheme: "oauth",
  },
};

const GithubResources = createGithubRepositoryResources({
  connectionId: GithubConnection.id,
  items: RepositoryItems,
});

function IntegrationsEditorSectionStory(): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createQueryClient();

    for (const searchTerm of resolveRepositorySearchTerms(RepositoryItems)) {
      client.setQueryData(
        [
          "integration-connections",
          GithubResources.connectionId,
          "resources",
          GithubResources.kind,
          searchTerm,
        ],
        createGithubRepositoryResources({
          connectionId: GithubConnection.id,
          items: filterRepositoryItems(RepositoryItems, searchTerm),
        }),
      );
    }

    return client;
  });
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>([]);

  return (
    <QueryClientProvider client={queryClient}>
      <IntegrationsEditorSection
        availableConnections={[OpenAiConnection, GithubConnection]}
        availableTargets={[OpenAiTarget, GithubTarget]}
        integrationBindingsQuery={{
          isError: false,
          error: null,
          isPending: false,
        }}
        integrationDirectoryQuery={{
          isError: false,
          error: null,
          isPending: false,
        }}
        integrationRowErrorsByClientId={{}}
        integrationRows={rows}
        integrationSaveError={null}
        integrationSaveSuccess={false}
        isSavingIntegrationBindings={false}
        onAddIntegrationBindingRow={async (input) => {
          setRows((currentRows) => [
            ...currentRows,
            {
              clientId: `row-${String(currentRows.length + 1)}`,
              connectionId: input.connectionId,
              kind: input.kind,
              config: input.config,
            },
          ]);
          return true;
        }}
        onIntegrationBindingRowChange={(clientId, changes) => {
          setRows((currentRows) =>
            currentRows.map((row) => (row.clientId === clientId ? { ...row, ...changes } : row)),
          );
        }}
        onRemoveIntegrationBindingRow={(clientId) => {
          setRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
        }}
        resolveSelectedConnectionDisplayName={(row) =>
          [OpenAiConnection, GithubConnection].find(
            (connection) => connection.id === row.connectionId,
          )?.displayName
        }
      />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Pages/IntegrationsEditorSection",
  decorators: [withDashboardPageWidth],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <IntegrationsEditorSectionStory />;
  },
};
