import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { PageFrame } from "../shared/page-frame.js";
import { createAvailableCardsOverview } from "./organization-integrations-settings-page-story-support.js";
import {
  OrganizationIntegrationsSettingsPageView,
  type OrganizationIntegrationsSettingsPageCard,
} from "./organization-integrations-settings-page-view.js";

const ConnectedCards: readonly OrganizationIntegrationsSettingsPageCard[] = [
  {
    targetKey: "github-cloud",
    integrationKind: "git",
    displayName: "GitHub",
    description: "2 connections",
    configStatus: "valid",
    logoKey: "github",
    actionLabel: "View",
    actionHref: "/integrations/github-cloud",
  },
  {
    targetKey: "linear-default",
    integrationKind: "connector",
    displayName: "Linear",
    description: "1 connection",
    configStatus: "invalid",
    logoKey: "linear",
    actionLabel: "View",
    actionHref: "/integrations/linear-default",
  },
] as const;

const AvailableCards = createAvailableCardsOverview();
const ManyAvailableCards = Array.from({ length: 4 }, (_, groupIndex) =>
  AvailableCards.map((card) => ({
    ...card,
    targetKey: `${card.targetKey}-overflow-${groupIndex + 1}`,
  })),
).flat();

const meta = {
  title: "Dashboard/Integrations/Overview",
  component: OrganizationIntegrationsSettingsPageView,
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/integrations"]}>
        <Story />
      </MemoryRouter>
    ),
    withDashboardPageStory,
  ],
  args: {
    availableCards: AvailableCards,
    connectedCards: ConnectedCards,
    loadErrorMessage: null,
  },
} satisfies Meta<typeof OrganizationIntegrationsSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoConnectedIntegrations: Story = {
  args: {
    connectedCards: [],
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

export const ManyIntegrationsInAppShellViewport: Story = {
  args: {
    availableCards: ManyAvailableCards,
    connectedCards: [],
  },
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div className="h-svh overflow-hidden bg-background">
        <div className="min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-w-0 min-h-0 flex-1">
            <PageFrame
              description="Manage the integrations and tools available to your organization."
              title="Integrations"
              width="normal"
            >
              <Story />
            </PageFrame>
          </div>
        </div>
      </div>
    ),
  ],
};
