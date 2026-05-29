import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
  StoryAnthropicConnection,
  StoryBindings,
  StoryGithubConnection,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryMistleApiKey,
  StoryOpenCodeGoConnection,
  StorySlackConnection,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Runtime And Connections",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardCenteredStory],
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: DefaultSandboxProfileEditorStoryArgs,
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CombinedIntegrationsConnectionsAndTools: Story = {};

const StoryTargetsWithoutGitConnections = StoryIntegrationTargets.filter(
  (target) => target.familyId !== "github",
);
const StoryGitConnectionTargetKeys = new Set(
  StoryIntegrationTargets.filter((target) => target.familyId === "github").map(
    (target) => target.targetKey,
  ),
);
const StoryConnectionsWithoutGitConnections = StoryIntegrationConnections.filter(
  (connection) => !StoryGitConnectionTargetKeys.has(connection.targetKey),
);

export const RuntimeAndConnectionsLoadError: Story = {
  args: {
    integrationsSectionState: {
      kind: "error",
      bindingsErrorMessage: "Could not load sandbox profile integration bindings.",
      directoryErrorMessage: "Could not load integration connections.",
    },
  },
};

export const MistleMcpEnabled: Story = {
  args: {
    mistleMcpEnabled: true,
    mistleMcpApiKeyId: StoryMistleApiKey.id,
  },
};

export const MistleMcpNoApiKeys: Story = {
  args: {
    apiKeys: [],
    mistleMcpEnabled: true,
  },
};

export const GitCommitSigningEnabled: Story = {
  args: {
    identityLinkedGitConnectionIds: [StoryGithubConnection.id],
    initialGitCommitSigningIntegrationConnectionId: StoryGithubConnection.id,
  },
};

export const GitCommitSigningUnavailable: Story = {
  args: {
    identityLinkedGitConnectionIds: [],
  },
};

export const StaleConnectorBinding: Story = {
  args: {
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-connector",
        connectionId: "connection-missing",
        kind: "connector",
        config: {},
      },
    ],
  },
};

export const StaleConnectorMissingTarget: Story = {
  args: {
    availableConnections: StoryIntegrationConnections,
    availableTargets: StoryIntegrationTargets.filter(
      (target) => target.targetKey !== StorySlackConnection.targetKey,
    ),
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-connector-missing-target",
        connectionId: StorySlackConnection.id,
        kind: "connector",
        config: {},
      },
    ],
  },
};

export const StaleGitConnectionBinding: Story = {
  args: {
    initialBindings: [
      ...StoryBindings.filter((binding) => binding.kind !== "git"),
      {
        id: "binding-stale-git",
        connectionId: "missing-git-connection",
        kind: "git",
        config: {},
      },
    ],
  },
};

export const DraftWithNoGitConnectionsSetup: Story = {
  args: {
    availableConnections: StoryConnectionsWithoutGitConnections,
    availableTargets: StoryTargetsWithoutGitConnections,
    initialBindings: StoryBindings.filter((binding) => binding.kind !== "git"),
  },
};

export const CodexOnlyOpenAiProxiedConnection: Story = {
  args: {
    agentRuntimeId: "codex",
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-opencode-go-agent",
        connectionId: StoryOpenCodeGoConnection.id,
        kind: "agent",
        config: {},
      },
      {
        id: "binding-anthropic-agent",
        connectionId: StoryAnthropicConnection.id,
        kind: "agent",
        config: {},
      },
    ],
  },
};

export const OpenCodeProviderProxiedConnections: Story = {
  args: {
    agentRuntimeId: "opencode",
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-opencode-go-agent",
        connectionId: StoryOpenCodeGoConnection.id,
        kind: "agent",
        config: {},
      },
      {
        id: "binding-anthropic-agent",
        connectionId: StoryAnthropicConnection.id,
        kind: "agent",
        config: {},
      },
    ],
  },
};

export const StaleOpenCodeAgentProviderBinding: Story = {
  args: {
    agentRuntimeId: "opencode",
    initialBindings: [
      ...StoryBindings.filter((binding) => binding.kind !== "agent"),
      {
        id: "binding-stale-agent-provider",
        connectionId: "missing-agent-connection",
        kind: "agent",
        config: {},
      },
    ],
  },
};

export const PublishedWithoutConnectorIntegrations: Story = {
  args: {
    lifecycleState: "published",
    initialBindings: StoryBindings.filter(
      (binding) => binding.kind === "agent" || binding.kind === "git",
    ),
  },
};

export const StaleGitConnectionMissingTarget: Story = {
  args: {
    availableConnections: StoryIntegrationConnections,
    availableTargets: StoryIntegrationTargets.filter(
      (target) => target.targetKey !== StoryGithubConnection.targetKey,
    ),
    initialBindings: [
      ...StoryBindings,
      {
        id: "binding-stale-git-missing-target",
        connectionId: StoryGithubConnection.id,
        kind: "git",
        config: {},
      },
    ],
  },
};
