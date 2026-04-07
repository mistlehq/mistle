import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { SandboxIntegrationBindingKinds } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryOpenAiConnection,
} from "./integrations-editor-section-story-support.js";
import type { SandboxProfileBindingEditorRow } from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileBindingDialog,
  type SandboxProfileBindingDialogState,
} from "./sandbox-profile-binding-dialog.js";

const AvailableConnectionsByKind = {
  [SandboxIntegrationBindingKinds.AGENT]: [StoryOpenAiConnection],
  [SandboxIntegrationBindingKinds.GIT]: [StoryGithubConnection],
  [SandboxIntegrationBindingKinds.CONNECTOR]: [],
} as const;

const OpenAiInitialRow: SandboxProfileBindingEditorRow = {
  clientId: "binding-row-story-001",
  connectionId: StoryOpenAiConnection.id,
  kind: SandboxIntegrationBindingKinds.AGENT,
  config: {},
};

const GithubInitialRow: SandboxProfileBindingEditorRow = {
  clientId: "binding-row-story-002",
  connectionId: StoryGithubConnection.id,
  kind: SandboxIntegrationBindingKinds.GIT,
  config: {},
};

function SandboxProfileBindingDialogStory(input: {
  error: string | null;
  row: SandboxProfileBindingEditorRow;
}): React.JSX.Element {
  const [queryClient] = useState(() => createIntegrationsEditorSectionStoryQueryClient());
  const [state, setState] = useState<SandboxProfileBindingDialogState>({
    mode: "add",
    row: input.row,
    error: input.error,
  });

  return (
    <QueryClientProvider client={queryClient}>
      <SandboxProfileBindingDialog
        availableConnections={StoryIntegrationConnections}
        availableConnectionsByKind={AvailableConnectionsByKind}
        availableTargets={StoryIntegrationTargets}
        bindingFormContext={
          input.row.kind === SandboxIntegrationBindingKinds.GIT
            ? {
                resourceOverrides: [StoryGithubResources],
              }
            : undefined
        }
        isSubmittingIntegrationBindings={false}
        onClose={() => {}}
        onConnectionIdChange={(nextConnectionId) => {
          setState((currentState) => ({
            ...currentState,
            row: {
              ...currentState.row,
              connectionId: nextConnectionId,
            },
          }));
        }}
        onRowChange={(clientId, changes) => {
          setState((currentState) => ({
            ...currentState,
            row:
              currentState.row.clientId === clientId
                ? {
                    ...currentState.row,
                    ...changes,
                  }
                : currentState.row,
          }));
        }}
        onSave={() => {}}
        resolveSelectedConnectionDisplayName={(row) =>
          StoryIntegrationConnections.find((connection) => connection.id === row.connectionId)
            ?.displayName
        }
        state={state}
      />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/SandboxProfiles/Integrations/BindingDialog",
  component: SandboxProfileBindingDialog,
  decorators: [withDashboardCenteredStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SandboxProfileBindingDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AddOpenAiBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={OpenAiInitialRow} />;
  },
};

export const AddGithubBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={GithubInitialRow} />;
  },
};
