import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { SandboxIntegrationBindingKinds } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
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
  [SandboxIntegrationBindingKinds.GIT]: [],
  [SandboxIntegrationBindingKinds.CONNECTOR]: [],
} as const;

const InitialRow: SandboxProfileBindingEditorRow = {
  clientId: "binding-row-story-001",
  connectionId: StoryOpenAiConnection.id,
  kind: SandboxIntegrationBindingKinds.AGENT,
  config: {},
};

function SandboxProfileBindingDialogStory(input: {
  error: string | null;
  isSubmittingIntegrationBindings: boolean;
}): React.JSX.Element {
  const [state, setState] = useState<SandboxProfileBindingDialogState>({
    mode: "add",
    row: InitialRow,
    error: input.error,
  });

  return (
    <SandboxProfileBindingDialog
      availableConnections={StoryIntegrationConnections}
      availableConnectionsByKind={AvailableConnectionsByKind}
      availableTargets={StoryIntegrationTargets}
      isSubmittingIntegrationBindings={input.isSubmittingIntegrationBindings}
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
    return (
      <SandboxProfileBindingDialogStory error={null} isSubmittingIntegrationBindings={false} />
    );
  },
};

export const AddOpenAiBindingPending: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} isSubmittingIntegrationBindings={true} />;
  },
};
