import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type React from "react";
import { expect, userEvent, within } from "storybook/test";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import {
  IntegrationConnectionDetailView,
  type IntegrationConnectionDetailItem,
} from "../integrations/integration-connection-detail-view.js";
import {
  OrganizationIntegrationsSettingsPageView,
  type OrganizationIntegrationsSettingsPageCard,
} from "./organization-integrations-settings-page-view.js";

const ConnectedCards: readonly OrganizationIntegrationsSettingsPageCard[] = [
  {
    targetKey: "github",
    displayName: "GitHub",
    description: "2 connections",
    configStatus: "valid",
    logoKey: "github",
    actionLabel: "View",
    onAction: () => {},
  },
  {
    targetKey: "linear",
    displayName: "Linear",
    description: "1 connection",
    configStatus: "invalid",
    logoKey: "linear",
    actionLabel: "View",
    onAction: () => {},
  },
] as const;

const AvailableCards: readonly OrganizationIntegrationsSettingsPageCard[] = [
  {
    targetKey: "openai-default",
    displayName: "OpenAI",
    description: "Bring organization API access into Mistle.",
    configStatus: "valid",
    logoKey: "openai",
    actionLabel: "Add",
    onAction: () => {},
  },
  {
    targetKey: "slack",
    displayName: "Slack",
    description: "Link channels and workspace context.",
    configStatus: "valid",
    logoKey: "slack",
    actionLabel: "Add",
    onAction: () => {},
  },
  {
    targetKey: "custom-api",
    displayName: "Custom API",
    description: "No supported auth methods are configured.",
    configStatus: "invalid",
    actionDisabled: true,
    actionLabel: "Add",
    onAction: () => {},
  },
] as const;

const DetailConnections: readonly IntegrationConnectionDetailItem[] = [
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
] as const;

const meta = {
  title: "Dashboard/Pages/OrganizationIntegrationsSettingsPageView",
  component: OrganizationIntegrationsSettingsPageView,
  decorators: [withDashboardPageWidth],
  args: {
    availableCards: AvailableCards,
    connectedCards: ConnectedCards,
    isLoading: false,
    loadErrorMessage: null,
    onRetryLoad: () => {},
  },
} satisfies Meta<typeof OrganizationIntegrationsSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    isLoading: true,
  },
};

export const LoadError: Story = {
  args: {
    loadErrorMessage: "Could not load integrations.",
  },
};

export const Empty: Story = {
  args: {
    availableCards: [],
    connectedCards: [],
  },
};

export const WithDetailSurfacePreview: Story = {
  args: {
    detailSurface: (
      <div className="pt-2">
        <IntegrationConnectionDetailView
          connections={DetailConnections}
          onSelectConnection={() => {}}
          selectedConnectionId="icn_github_primary"
          targetDisplayName="GitHub"
          targetKey="github"
        />
      </div>
    ),
  },
};

export const InteractiveSelectionFlow: Story = {
  render: function RenderStory(): React.JSX.Element {
    const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);

    const connectedCards = ConnectedCards.map((card) => ({
      ...card,
      onAction: () => {
        setSelectedTargetKey(card.targetKey);
      },
    }));

    return (
      <OrganizationIntegrationsSettingsPageView
        availableCards={AvailableCards}
        connectedCards={connectedCards}
        detailSurface={
          selectedTargetKey === "github" ? (
            <div className="pt-2">
              <IntegrationConnectionDetailView
                connections={DetailConnections}
                onSelectConnection={() => {}}
                selectedConnectionId="icn_github_primary"
                targetDisplayName="GitHub"
                targetKey="github"
              />
            </div>
          ) : null
        }
        isLoading={false}
        loadErrorMessage={null}
        onRetryLoad={() => {}}
      />
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const [firstViewButton] = canvas.getAllByRole("button", { name: "View" });
    if (firstViewButton === undefined) {
      throw new Error("Expected a View button.");
    }

    await userEvent.click(firstViewButton);
    await expect(canvas.getByText("Engineering GitHub")).toBeVisible();
    await expect(canvas.getByText("Resource readiness")).toBeVisible();
  },
};
