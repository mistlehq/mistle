import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { SandboxIntegrationBindingKinds } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryAwsConnection,
  StoryDatadogConnection,
  StoryGithubConnection,
  StoryGithubEnterpriseServerConnection,
  StoryIntegrationConnections,
  StoryIntegrationResources,
  StoryIntegrationTargets,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryOpenAiConnection,
  StoryPlanetScaleConnection,
  StorySignozConnection,
  StorySlackConnection,
} from "./integrations-editor-section-story-support.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileBindingDialog,
  type SandboxProfileBindingDialogState,
} from "./sandbox-profile-binding-dialog.js";

const AvailableConnectionsByKind = {
  [SandboxIntegrationBindingKinds.AGENT]: [StoryOpenAiConnection],
  [SandboxIntegrationBindingKinds.GIT]: [
    StoryGithubConnection,
    StoryGithubEnterpriseServerConnection,
  ],
  [SandboxIntegrationBindingKinds.CONNECTOR]: [
    StoryAwsConnection,
    StoryDatadogConnection,
    StoryJiraConnection,
    StoryLinearConnection,
    StoryPlanetScaleConnection,
    StorySignozConnection,
    StorySlackConnection,
  ],
} as const;

function createStoryBindingRow(
  connectionId: string,
  clientId: string,
): SandboxProfileBindingEditorRow {
  const connection = StoryIntegrationConnections.find((candidate) => candidate.id === connectionId);
  const target = StoryIntegrationTargets.find(
    (candidate) => candidate.targetKey === connection?.targetKey,
  );
  const kind = resolveBindingKindFromTarget(target);
  if (connection === undefined || target === undefined || kind === undefined) {
    throw new Error(`Could not resolve story binding row for connection '${connectionId}'.`);
  }

  return {
    clientId,
    connectionId: connection.id,
    kind,
    config: createDefaultBindingConfig({
      connection,
      target,
    }),
  };
}

function SandboxProfileBindingDialogStory(input: {
  error: string | null;
  row: SandboxProfileBindingEditorRow;
}): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createIntegrationsEditorSectionStoryQueryClient();
    for (const resources of StoryIntegrationResources) {
      seedStoryIntegrationResources({
        queryClient: client,
        resources,
      });
    }
    return client;
  });
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
        state={state}
      />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/SandboxProfiles/Integrations/BindingDialog",
  component: SandboxProfileBindingDialog,
  decorators: [withDashboardCenteredStory],
  args: {
    state: null,
    availableConnections: StoryIntegrationConnections,
    availableConnectionsByKind: AvailableConnectionsByKind,
    availableTargets: StoryIntegrationTargets,
    isSubmittingIntegrationBindings: false,
    onClose: () => {},
    onConnectionIdChange: () => {},
    onRowChange: () => {},
    onSave: () => {},
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SandboxProfileBindingDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

const OpenAiInitialRow = createStoryBindingRow("connection-openai", "binding-row-story-openai");
const GithubCloudInitialRow = createStoryBindingRow(
  "connection-github",
  "binding-row-story-github-cloud",
);
const GithubEnterpriseServerInitialRow = createStoryBindingRow(
  "connection-github-enterprise-server",
  "binding-row-story-github-enterprise-server",
);
const AwsInitialRow = createStoryBindingRow("connection-aws", "binding-row-story-aws");
const DatadogInitialRow = createStoryBindingRow("connection-datadog", "binding-row-story-datadog");
const JiraInitialRow = createStoryBindingRow("connection-jira", "binding-row-story-jira");
const LinearInitialRow = createStoryBindingRow("connection-linear", "binding-row-story-linear");
const PlanetScaleInitialRow = createStoryBindingRow(
  "connection-planetscale",
  "binding-row-story-planetscale",
);
const SignozInitialRow = createStoryBindingRow("connection-signoz", "binding-row-story-signoz");
const SlackInitialRow = createStoryBindingRow("connection-slack", "binding-row-story-slack");

export const AddOpenAiBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={OpenAiInitialRow} />;
  },
};

export const AddGithubCloudBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={GithubCloudInitialRow} />;
  },
};

export const AddGithubEnterpriseServerBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={GithubEnterpriseServerInitialRow} />;
  },
};

export const AddAwsBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={AwsInitialRow} />;
  },
};

export const AddDatadogBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={DatadogInitialRow} />;
  },
};

export const AddJiraBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={JiraInitialRow} />;
  },
};

export const AddLinearBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={LinearInitialRow} />;
  },
};

export const AddPlanetScaleBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={PlanetScaleInitialRow} />;
  },
};

export const AddSignozBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={SignozInitialRow} />;
  },
};

export const AddSlackBinding: Story = {
  render: function RenderStory(): React.JSX.Element {
    return <SandboxProfileBindingDialogStory error={null} row={SlackInitialRow} />;
  },
};
