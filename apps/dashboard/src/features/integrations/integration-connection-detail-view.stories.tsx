import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";
import {
  createDetailViewStoryProps,
  createRefreshingDetailViewStoryProps,
  getPrimaryDemoIntegrationConnection,
} from "./integration-story-harness.js";

const meta = {
  title: "Dashboard/Integrations/IntegrationConnectionDetailView",
  component: IntegrationConnectionDetailView,
  decorators: [withDashboardCenteredSurface],
  args: {
    ...createDetailViewStoryProps(),
    onEditApiKey: () => {},
    onRefreshResource: () => {},
  },
} satisfies Meta<typeof IntegrationConnectionDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StackedConnections: Story = {};

export const ApiKeyConnectionWithSyncError: Story = {
  args: {},
};

export const Refreshing: Story = {
  args: {
    ...createRefreshingDetailViewStoryProps(),
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
    const refreshButton = canvas.getByRole("button", { name: "Refresh repositories" });
    await userEvent.click(refreshButton);
    await expect(refreshButton).toBeDisabled();
  },
};
