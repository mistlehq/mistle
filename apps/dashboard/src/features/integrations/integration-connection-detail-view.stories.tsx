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
  title: "Dashboard/Integrations/ConnectionDetail/StateExamples",
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
type DetailViewStoryProps = React.ComponentProps<typeof IntegrationConnectionDetailView>;

function createAutoSyncAfterConnectionStoryProps(): DetailViewStoryProps {
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
};

const WebhookSyncScenarios: {
  readonly GITHUB_INSTALLATION_UNAVAILABLE: "github-installation-unavailable";
  readonly GITHUB_URL_MISMATCH: "github-url-mismatch";
  readonly GITHUB_CONTENT_TYPE_MISMATCH: "github-content-type-mismatch";
  readonly GITHUB_MISSING_PRIVATE_KEY: "github-missing-private-key";
  readonly GITHUB_SYNCING: "github-syncing";
  readonly SLACK_REQUEST_URL_MISMATCH: "slack-request-url-mismatch";
  readonly SLACK_MANIFEST_EXPORT_FAILED: "slack-manifest-export-failed";
  readonly SLACK_SYNCING: "slack-syncing";
} = {
  GITHUB_INSTALLATION_UNAVAILABLE: "github-installation-unavailable",
  GITHUB_URL_MISMATCH: "github-url-mismatch",
  GITHUB_CONTENT_TYPE_MISMATCH: "github-content-type-mismatch",
  GITHUB_MISSING_PRIVATE_KEY: "github-missing-private-key",
  GITHUB_SYNCING: "github-syncing",
  SLACK_REQUEST_URL_MISMATCH: "slack-request-url-mismatch",
  SLACK_MANIFEST_EXPORT_FAILED: "slack-manifest-export-failed",
  SLACK_SYNCING: "slack-syncing",
};

type WebhookSyncScenario = (typeof WebhookSyncScenarios)[keyof typeof WebhookSyncScenarios];

type WebhookSyncStatesStoryArgs = {
  scenario: WebhookSyncScenario;
};

function createWebhookSyncStateStoryProps(input: {
  baseProps: DetailViewStoryProps;
  isSyncing?: boolean;
  syncErrorMessage?: string;
}): DetailViewStoryProps {
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

function createWebhookSyncScenarioStoryProps(input: {
  scenario: WebhookSyncScenario;
}): DetailViewStoryProps {
  if (input.scenario === WebhookSyncScenarios.GITHUB_URL_MISMATCH) {
    return createWebhookSyncStateStoryProps({
      baseProps: createGitHubAppDetailViewStoryProps(),
      syncErrorMessage: WebhookSyncErrorMessages.GITHUB_WEBHOOK_URL_MISMATCH,
    });
  }

  if (input.scenario === WebhookSyncScenarios.GITHUB_CONTENT_TYPE_MISMATCH) {
    return createWebhookSyncStateStoryProps({
      baseProps: createGitHubAppDetailViewStoryProps(),
      syncErrorMessage: WebhookSyncErrorMessages.GITHUB_WEBHOOK_CONTENT_TYPE,
    });
  }

  if (input.scenario === WebhookSyncScenarios.GITHUB_MISSING_PRIVATE_KEY) {
    return createWebhookSyncStateStoryProps({
      baseProps: createGitHubAppDetailViewStoryProps(),
      syncErrorMessage: WebhookSyncErrorMessages.GITHUB_MISSING_PRIVATE_KEY,
    });
  }

  if (input.scenario === WebhookSyncScenarios.GITHUB_SYNCING) {
    return createWebhookSyncStateStoryProps({
      baseProps: createGitHubAppDetailViewStoryProps(),
      isSyncing: true,
    });
  }

  if (input.scenario === WebhookSyncScenarios.SLACK_REQUEST_URL_MISMATCH) {
    return createWebhookSyncStateStoryProps({
      baseProps: createSlackDetailViewStoryProps(),
      syncErrorMessage: WebhookSyncErrorMessages.SLACK_REQUEST_URL_MISMATCH,
    });
  }

  if (input.scenario === WebhookSyncScenarios.SLACK_MANIFEST_EXPORT_FAILED) {
    return createWebhookSyncStateStoryProps({
      baseProps: createSlackDetailViewStoryProps(),
      syncErrorMessage: WebhookSyncErrorMessages.SLACK_MANIFEST_EXPORT_FAILED,
    });
  }

  if (input.scenario === WebhookSyncScenarios.SLACK_SYNCING) {
    return createWebhookSyncStateStoryProps({
      baseProps: createSlackDetailViewStoryProps(),
      isSyncing: true,
    });
  }

  return createWebhookSyncStateStoryProps({
    baseProps: createGitHubAppDetailViewStoryProps(),
    syncErrorMessage: WebhookSyncErrorMessages.GITHUB_INSTALLATION_UNAVAILABLE,
  });
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

export const WebhookSyncStates: StoryObj<WebhookSyncStatesStoryArgs> = {
  args: {
    scenario: WebhookSyncScenarios.GITHUB_INSTALLATION_UNAVAILABLE,
  },
  argTypes: {
    scenario: {
      control: "select",
      options: [
        WebhookSyncScenarios.GITHUB_INSTALLATION_UNAVAILABLE,
        WebhookSyncScenarios.GITHUB_URL_MISMATCH,
        WebhookSyncScenarios.GITHUB_CONTENT_TYPE_MISMATCH,
        WebhookSyncScenarios.GITHUB_MISSING_PRIVATE_KEY,
        WebhookSyncScenarios.GITHUB_SYNCING,
        WebhookSyncScenarios.SLACK_REQUEST_URL_MISMATCH,
        WebhookSyncScenarios.SLACK_MANIFEST_EXPORT_FAILED,
        WebhookSyncScenarios.SLACK_SYNCING,
      ],
    },
  },
  render: function RenderStory(input) {
    return (
      <IntegrationConnectionDetailView
        {...createWebhookSyncScenarioStoryProps({
          scenario: input.scenario,
        })}
        onEditAuthentication={(_connectionId: string) => {}}
        onRefreshResource={(_payload: { connectionId: string; kind: string }) => {}}
      />
    );
  },
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
