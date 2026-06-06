import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { StoryAwsConnection } from "./integrations-editor-section-story-support.js";
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

export const AddConnectorsDialog: Story = {
  args: {
    availableConnections: StoryIntegrationConnections.filter(
      (connection) => connection.id !== StoryAwsConnection.id,
    ),
    initialBindings: StoryBindings.filter((binding) => binding.kind !== "connector"),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole("button", { name: "Add integration or tool" }));

    const dialog = body.getByRole("dialog", { name: "Add connectors" });
    await expect(dialog).toBeVisible();
    const dialogScope = within(dialog);
    await expect(dialogScope.getByText("AWS")).toBeVisible();
    await expect(dialogScope.getByText("PlanetScale")).toBeVisible();

    const logoSources = Array.from(
      dialog.querySelectorAll<HTMLImageElement>('img[src^="/integration-logos/"]'),
    ).map((image) => image.getAttribute("src"));
    await expect(logoSources).toContain("/integration-logos/planetscale.svg");
    await expect(logoSources).toContain("/integration-logos/planetscale-dark.svg");
    await expect(logoSources).not.toContain("/integration-logos/aws-dark.svg");
  },
};

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
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await expect(canvas.getByRole("combobox", { name: "Mistle resources" })).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "View allowed Mistle resources: 3 resources" }),
    ).toBeVisible();

    await userEvent.click(
      canvas.getByRole("button", { name: "View allowed Mistle resources: 3 resources" }),
    );

    const dialog = body.getByRole("dialog", { name: "Allowed Mistle resources" });
    await expect(dialog).toBeVisible();
    await expect(
      within(dialog).getByText(
        "This profile's agent can use Sandbox agent key for these Mistle resources. Access is limited by that API key's permissions.",
      ),
    ).toBeVisible();
    await expect(within(dialog).getByText("Sandbox profiles")).toBeVisible();
    await expect(within(dialog).getByText("Sessions")).toBeVisible();
    await expect(within(dialog).getByText("Triggers")).toBeVisible();
    await expect(within(dialog).getByText("Connect to sessions")).toBeVisible();
    await expect(within(dialog).getByText("Delete triggers")).toBeVisible();
  },
};

export const MistleMcpNoApiKeys: Story = {
  args: {
    apiKeys: [],
    mistleMcpEnabled: true,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);

    await expect(canvas.getByRole("button", { name: "Create new API key" })).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Create new API key" }));

    const dialog = body.getByRole("dialog", { name: "Create new API key" });
    await expect(dialog).toBeVisible();
    await expect(within(dialog).getByText("4 selected")).toBeVisible();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Select all" }));
    await expect(within(dialog).getByText("12 selected")).toBeVisible();
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

export const GitConnectionNone: Story = {
  args: {
    initialBindings: StoryBindings.filter((binding) => binding.kind !== "git"),
    initialGitCommitSigningIntegrationConnectionId: null,
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("combobox", { name: "git connection" }).textContent).toContain(
      "None",
    );
    await expect(canvas.queryByRole("switch", { name: "Sign Git commits" })).toBeNull();
    await expect(canvas.queryByText("Select a Git connection")).toBeNull();
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
