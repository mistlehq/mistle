import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";
import {
  createDetailViewStoryProps,
  createRefreshingDetailViewStoryProps,
  createGitHubNotSyncedDetailViewStoryProps,
  getPrimaryDemoIntegrationConnection,
} from "./integration-story-harness.js";

const meta = {
  title: "Dashboard/Integrations/Connection/DetailView",
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
    const refreshButton = canvas.getByRole("button", { name: "Refresh repositories" });
    await userEvent.click(refreshButton);
    await expect(refreshButton).toBeDisabled();
  },
};
