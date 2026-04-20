import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardMemoryRouter, withDashboardPageStory } from "../../storybook/decorators.js";
import {
  OrganizationIdentityLinkingSettingsPageView,
  type OrganizationIdentityLinkingProviderCard,
} from "./organization-identity-linking-settings-page-view.js";

const GitHubConnectionOptions = [
  {
    id: "conn_github_primary",
    label: "GitHub Engineering",
  },
  {
    id: "conn_github_backup",
    label: "GitHub Platform",
  },
] as const satisfies OrganizationIdentityLinkingProviderCard["eligibleConnections"];

const BaseGitHubProvider: OrganizationIdentityLinkingProviderCard = {
  providerFamily: "github",
  displayName: "GitHub",
  logoKey: "github",
  configurationStatusLabel: "Configured",
  configurationStatusTone: "unconfigured",
  eligibleConnections: GitHubConnectionOptions,
  selectedConnectionId: "conn_github_primary",
  configureActionLabel: "Save connection",
  statusActionLabel: "Enable",
  statusActionNextStatus: "active",
  addConnectionOptions: [
    {
      href: "/settings/organization/integrations/new?target=github-cloud",
      label: "Connect new",
    },
  ],
  statusActionVisible: false,
  statusActionDisabled: false,
  saveActionDisabled: false,
  saveActionPending: false,
  statusActionPending: false,
  memberLinksLoading: false,
  memberLinksErrorMessage: null,
  memberLinks: [],
};

const meta = {
  title: "Dashboard/Settings/OrganizationIdentityLinking/PageView",
  component: OrganizationIdentityLinkingSettingsPageView,
  decorators: [withDashboardPageStory, withDashboardMemoryRouter],
  args: {
    loadErrorMessage: null,
    providers: [BaseGitHubProvider],
    onProviderConnectionChange: () => {},
    onSaveProvider: async () => {},
    onStatusAction: async () => {},
  },
} satisfies Meta<typeof OrganizationIdentityLinkingSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LoadError: Story = {
  args: {
    loadErrorMessage: "Could not load identity-linking providers.",
    providers: [],
  },
};

export const NoProvidersAvailable: Story = {
  args: {
    providers: [],
  },
};

export const UnconfiguredWithoutEligibleConnections: Story = {
  args: {
    providers: [
      {
        ...BaseGitHubProvider,
        configurationStatusLabel: "Not configured",
        eligibleConnections: [],
        selectedConnectionId: null,
        saveActionDisabled: true,
      },
    ],
  },
};

export const ActiveProvider: Story = {
  args: {
    providers: [
      {
        ...BaseGitHubProvider,
        configurationStatusLabel: "Active",
        configurationStatusTone: "active",
        statusActionLabel: "Disable",
        statusActionNextStatus: "disabled",
        statusActionVisible: true,
      },
    ],
  },
};

export const PendingActions: Story = {
  args: {
    providers: [
      {
        ...BaseGitHubProvider,
        saveActionPending: true,
        statusActionDisabled: true,
      },
    ],
  },
};

export const ProviderError: Story = {
  args: {
    providers: [
      {
        ...BaseGitHubProvider,
        configurationStatusLabel: "Disabled",
        configurationStatusTone: "disabled",
        errorMessage: "Could not save GitHub identity-linking settings.",
        statusActionLabel: "Enable",
        statusActionNextStatus: "active",
        statusActionVisible: true,
      },
    ],
  },
};
