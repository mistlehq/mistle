import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
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
