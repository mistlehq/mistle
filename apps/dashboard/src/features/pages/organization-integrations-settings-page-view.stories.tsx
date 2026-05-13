import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
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
    onAction: () => {},
  },
  {
    targetKey: "linear-default",
    integrationKind: "connector",
    displayName: "Linear",
    description: "1 connection",
    configStatus: "invalid",
    logoKey: "linear",
    actionLabel: "View",
    onAction: () => {},
  },
] as const;

const AvailableCards = createAvailableCardsOverview();

const meta = {
  title: "Dashboard/Integrations/Overview",
  component: OrganizationIntegrationsSettingsPageView,
  decorators: [withDashboardPageStory],
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
