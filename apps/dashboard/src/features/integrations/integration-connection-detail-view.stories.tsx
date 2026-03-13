import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardCenteredSurface } from "../../storybook/decorators.js";
import {
  IntegrationConnectionDetailView,
  type IntegrationConnectionDetailItem,
} from "./integration-connection-detail-view.js";

const DemoConnections: readonly IntegrationConnectionDetailItem[] = [
  {
    id: "icn_github_primary",
    displayName: "Engineering GitHub",
    status: "active",
    authMethodLabel: "OAuth",
    externalSubjectId: "mistle-labs",
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
    contextItems: [
      { label: "Installation", value: "Mistle Labs" },
      { label: "Default owner", value: "mistle-labs" },
    ],
    resources: [
      {
        kind: "repositories",
        selectionMode: "multi",
        count: 41,
        syncState: "ready",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      },
      {
        kind: "organizations",
        selectionMode: "single",
        count: 1,
        syncState: "ready",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      },
    ],
  },
  {
    id: "icn_github_archive",
    displayName: "Archive Mirror",
    status: "error",
    authMethodLabel: "API key",
    createdAt: "2026-02-14T00:00:00.000Z",
    updatedAt: "2026-03-10T10:15:00.000Z",
    contextItems: [{ label: "Default owner", value: "mistle-archive" }],
    resources: [
      {
        kind: "repositories",
        selectionMode: "multi",
        count: 0,
        syncState: "error",
        lastErrorMessage: "GitHub returned a 403 while reading repository visibility.",
      },
      {
        kind: "organizations",
        selectionMode: "single",
        count: 0,
        syncState: "never-synced",
      },
    ],
  },
] as const;

const [PrimaryConnection] = DemoConnections;
if (PrimaryConnection === undefined) {
  throw new Error("Expected a primary demo connection.");
}

const meta = {
  title: "Dashboard/Integrations/IntegrationConnectionDetailView",
  component: IntegrationConnectionDetailView,
  decorators: [withDashboardCenteredSurface],
  args: {
    connections: DemoConnections,
    onEditConnection: () => {},
    onRefreshResource: () => {},
    onSelectConnection: () => {},
    selectedConnectionId: "icn_github_primary",
    targetDisplayName: "GitHub",
    targetKey: "github",
  },
} satisfies Meta<typeof IntegrationConnectionDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const SyncIssue: Story = {
  args: {
    selectedConnectionId: "icn_github_archive",
  },
};

export const Refreshing: Story = {
  args: {
    connections: [
      {
        ...PrimaryConnection,
        resources: PrimaryConnection.resources.map((resource) =>
          resource.kind === "repositories"
            ? {
                ...resource,
                isRefreshing: true,
                syncState: "syncing",
              }
            : resource,
        ),
      },
    ],
  },
};

export const Empty: Story = {
  args: {
    connections: [],
    selectedConnectionId: null,
  },
};

export const InteractiveSelectionAndRefresh: Story = {
  render: function RenderStory(): React.JSX.Element {
    const [selectedConnectionId, setSelectedConnectionId] = useState("icn_github_primary");
    const [refreshingKinds, setRefreshingKinds] = useState<readonly string[]>([]);

    return (
      <IntegrationConnectionDetailView
        connections={DemoConnections.map((connection) => ({
          ...connection,
          resources: connection.resources.map((resource) => ({
            ...resource,
            isRefreshing:
              connection.id === selectedConnectionId && refreshingKinds.includes(resource.kind),
            syncState:
              connection.id === selectedConnectionId && refreshingKinds.includes(resource.kind)
                ? "syncing"
                : resource.syncState,
          })),
        }))}
        onEditConnection={() => {}}
        onRefreshResource={({ kind }) => {
          setRefreshingKinds([kind]);
        }}
        onSelectConnection={(connectionId) => {
          setSelectedConnectionId(connectionId);
          setRefreshingKinds([]);
        }}
        selectedConnectionId={selectedConnectionId}
        targetDisplayName="GitHub"
        targetKey="github"
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const engineeringButton = canvas.getByRole("button", { name: /Engineering GitHub/ });
    const archiveButton = canvas.getByRole("button", { name: /Archive Mirror/ });
    const [refreshButton] = canvas.getAllByRole("button", { name: "Refresh resources" });
    if (refreshButton === undefined) {
      throw new Error("Expected a Refresh resources button.");
    }

    await userEvent.click(archiveButton);
    await expect(
      canvas.getByText("GitHub returned a 403 while reading repository visibility."),
    ).toBeVisible();

    await userEvent.click(engineeringButton);
    await userEvent.click(refreshButton);
    await expect(canvas.getByRole("button", { name: "Refreshing..." })).toBeVisible();
  },
};
