import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";
import {
  createDetailViewStoryProps,
  createGitHubAppDetailViewStoryProps,
  createRefreshingDetailViewStoryProps,
  createGitHubNotSyncedDetailViewStoryProps,
  createSlackDetailViewStoryProps,
  getPrimaryDemoIntegrationConnection,
} from "./integration-story-harness.js";

const meta = {
  title: "Dashboard/Integrations/Connection Detail",
  component: IntegrationConnectionDetailView,
  decorators: [withDashboardCenteredStory],
  args: {
    ...createDetailViewStoryProps(),
    onEditAuthentication: (_connectionId: string) => {},
    onRefreshResource: (_input: { connectionId: string; kind: string }) => {},
  },
} satisfies Meta<typeof IntegrationConnectionDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;
type StoryArgs = NonNullable<Story["args"]>;

function createAutoSyncAfterConnectionStoryProps(): StoryArgs {
  const props = createGitHubNotSyncedDetailViewStoryProps();

  return {
    ...props,
    connections: props.connections.map((connection) => ({
      ...connection,
      resources: connection.resources.map((resource) => ({
        ...resource,
        isRefreshing: true,
      })),
    })),
  };
}

const WebhookSyncErrorMessages = {
  GITHUB_INSTALLATION_UNAVAILABLE:
    "GitHub App installation '116007157' trigger capabilities could not be refreshed: Not Found.",
  GITHUB_MISSING_PRIVATE_KEY:
    "Integration connection 'icn_github_dense' is missing GitHub App private key.",
  GITHUB_WEBHOOK_CONTENT_TYPE:
    "GitHub App webhook content type is 'form', expected 'json'. Set the GitHub App webhook content type to JSON, then sync again.",
  GITHUB_WEBHOOK_URL_MISMATCH:
    "GitHub App webhook URL is 'https://control-plane.example.com/p/integration/webhooks/github-cloud/old-endpoint', expected 'http://localhost:5100/p/integration/webhooks/github-cloud/-uV97vES3GH033SdR8524w'. Update the GitHub App webhook URL, then sync again.",
  SLACK_MANIFEST_EXPORT_FAILED: "Slack app manifest export failed: invalid_auth.",
  SLACK_REQUEST_URL_MISMATCH:
    "Slack Events API Request URL must be 'https://control-plane.example.com/p/integration/webhooks/slack-default/ep_slack_engineering' before webhook events can be synced. Current Slack Request URL is 'https://control-plane.example.com/p/integration/webhooks/slack-default/ep_slack_other'.",
} as const;

function createWebhookSyncStateStoryProps(input: {
  baseProps: StoryArgs;
  isSyncing?: boolean;
  syncErrorMessage?: string;
}): StoryArgs {
  const props = input.baseProps;
  const connections = props.connections ?? [];
  const selectedConnection = connections[0];
  if (selectedConnection === undefined) {
    throw new Error("Webhook sync state story requires a connection.");
  }

  const webhookSourceState =
    props.webhookSourceStateByConnectionId?.get(selectedConnection.id) ?? null;
  if (webhookSourceState === null) {
    throw new Error("Webhook sync state story requires webhook source state.");
  }

  return {
    ...props,
    renderWebhookSourceActions: () => (
      <Button disabled={input.isSyncing === true} size="sm" type="button" variant="outline">
        {input.isSyncing === true ? "Syncing..." : "Sync webhook events"}
      </Button>
    ),
    webhookSourceStateByConnectionId: new Map([
      [
        selectedConnection.id,
        {
          ...webhookSourceState,
          ...(input.syncErrorMessage === undefined
            ? {}
            : { syncErrorMessage: input.syncErrorMessage }),
        },
      ],
    ]),
  };
}

export const StackedConnections: Story = {};

export const ApiKeyConnectionWithSyncError: Story = {
  args: {},
};

export const Refreshing: Story = {
  args: {
    ...createRefreshingDetailViewStoryProps(),
  },
};

export const AutoSyncAfterConnection: Story = {
  name: "Auto-sync after connection",
  args: createAutoSyncAfterConnectionStoryProps(),
};

export const GitHubWebhookSyncError: Story = {
  name: "GitHub webhook sync error - installation unavailable",
  args: createWebhookSyncStateStoryProps({
    baseProps: createGitHubAppDetailViewStoryProps(),
    syncErrorMessage: WebhookSyncErrorMessages.GITHUB_INSTALLATION_UNAVAILABLE,
  }),
};

export const GitHubWebhookUrlMismatch: Story = {
  name: "GitHub webhook sync error - URL mismatch",
  args: createWebhookSyncStateStoryProps({
    baseProps: createGitHubAppDetailViewStoryProps(),
    syncErrorMessage: WebhookSyncErrorMessages.GITHUB_WEBHOOK_URL_MISMATCH,
  }),
};

export const GitHubWebhookContentTypeMismatch: Story = {
  name: "GitHub webhook sync error - content type mismatch",
  args: createWebhookSyncStateStoryProps({
    baseProps: createGitHubAppDetailViewStoryProps(),
    syncErrorMessage: WebhookSyncErrorMessages.GITHUB_WEBHOOK_CONTENT_TYPE,
  }),
};

export const GitHubWebhookMissingPrivateKey: Story = {
  name: "GitHub webhook sync error - missing private key",
  args: createWebhookSyncStateStoryProps({
    baseProps: createGitHubAppDetailViewStoryProps(),
    syncErrorMessage: WebhookSyncErrorMessages.GITHUB_MISSING_PRIVATE_KEY,
  }),
};

export const GitHubWebhookSyncing: Story = {
  name: "GitHub webhook sync - syncing",
  args: createWebhookSyncStateStoryProps({
    baseProps: createGitHubAppDetailViewStoryProps(),
    isSyncing: true,
  }),
};

export const SlackWebhookRequestUrlMismatch: Story = {
  name: "Slack webhook sync error - request URL mismatch",
  args: createWebhookSyncStateStoryProps({
    baseProps: createSlackDetailViewStoryProps(),
    syncErrorMessage: WebhookSyncErrorMessages.SLACK_REQUEST_URL_MISMATCH,
  }),
};

export const SlackWebhookManifestExportFailed: Story = {
  name: "Slack webhook sync error - manifest export failed",
  args: createWebhookSyncStateStoryProps({
    baseProps: createSlackDetailViewStoryProps(),
    syncErrorMessage: WebhookSyncErrorMessages.SLACK_MANIFEST_EXPORT_FAILED,
  }),
};

export const SlackWebhookSyncing: Story = {
  name: "Slack webhook sync - syncing",
  args: createWebhookSyncStateStoryProps({
    baseProps: createSlackDetailViewStoryProps(),
    isSyncing: true,
  }),
};

export const Empty: Story = {
  args: {
    connections: [],
  },
};

export const InteractiveRefresh: Story = {
  render: function RenderStory(): React.JSX.Element {
    const [refreshingResourceKeys, setRefreshingResourceKeys] = useState<readonly string[]>([]);
    const primaryConnection = getPrimaryDemoIntegrationConnection();
    const detailViewProps = createDetailViewStoryProps({
      connections: [primaryConnection],
      refreshingResourceKeys: new Set<string>(refreshingResourceKeys),
    });

    return (
      <IntegrationConnectionDetailView
        {...detailViewProps}
        onRefreshResource={({ connectionId, kind }) => {
          setRefreshingResourceKeys([`${connectionId}:${kind}`]);
        }}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Archive Mirror")).toBeNull();
    await expect(canvas.getByText("Engineering GitHub")).toBeVisible();
    const refreshButton = canvas.getByRole("button", { name: "Refresh repository" });
    await userEvent.click(refreshButton);
    await expect(refreshButton).toBeDisabled();
  },
};
