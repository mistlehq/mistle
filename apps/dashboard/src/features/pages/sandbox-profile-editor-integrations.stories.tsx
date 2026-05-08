import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
  StoryBindings,
  StoryGithubConnection,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StorySlackConnection,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Integrations",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: DefaultSandboxProfileEditorStoryArgs,
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

const StoryTargetsWithoutGitProviders = StoryIntegrationTargets.filter(
  (target) => target.familyId !== "github",
);
const StoryGitProviderTargetKeys = new Set(
  StoryIntegrationTargets.filter((target) => target.familyId === "github").map(
    (target) => target.targetKey,
  ),
);
const StoryConnectionsWithoutGitProviders = StoryIntegrationConnections.filter(
  (connection) => !StoryGitProviderTargetKeys.has(connection.targetKey),
);

export const AutosaveFailure: Story = {
  args: {
    integrationSaveErrorMessage:
      "Could not save sandbox profile integrations. Changes were not applied.",
  },
};

export const ResourcesAndToolsLoadError: Story = {
  args: {
    integrationsSectionState: {
      kind: "error",
      bindingsErrorMessage: "Could not load sandbox profile integration bindings.",
      directoryErrorMessage: "Could not load integration connections.",
    },
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

export const StaleGitProviderBinding: Story = {
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

export const DraftWithNoGitProvidersSetup: Story = {
  args: {
    availableConnections: StoryConnectionsWithoutGitProviders,
    availableTargets: StoryTargetsWithoutGitProviders,
    initialBindings: StoryBindings.filter((binding) => binding.kind !== "git"),
  },
};

export const StaleGitProviderMissingTarget: Story = {
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
