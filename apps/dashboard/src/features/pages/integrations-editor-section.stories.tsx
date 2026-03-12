import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryOpenAiConnection,
} from "./integrations-editor-section-story-support.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";
import { IntegrationsEditorSection } from "./sandbox-profile-editor-page.js";

function IntegrationsEditorSectionStory(): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createIntegrationsEditorSectionStoryQueryClient();
    return client;
  });
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>([]);

  return (
    <QueryClientProvider client={queryClient}>
      <IntegrationsEditorSection
        availableConnections={StoryIntegrationConnections}
        availableTargets={StoryIntegrationTargets}
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
        bindingFormContext={{
          resourceOverrides: [StoryGithubResources],
        }}
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
          [StoryOpenAiConnection, StoryGithubConnection].find(
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
