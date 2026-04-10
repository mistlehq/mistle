import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

const baseArgs = {
  activeOrganizationId: "org_mistle",
  isSwitchingOrganization: false,
  isMenuOpen: false,
  organizationName: "Mistle Labs",
  organizationImageUrl: null,
  organizationSummaryErrorMessage: null,
  organizationSwitcherErrorMessage: null,
  isSwitchOrganizationSubmenuOpen: false,
  organizations: [{ id: "org_mistle", name: "Mistle Labs" }],
  isSigningOut: false,
  onNavigateToSettings: function onNavigateToSettings() {},
  onSignOut: function onSignOut() {},
  onSwitchOrganization: function onSwitchOrganization() {},
} satisfies ComponentProps<typeof OrganizationMenuTrigger>;

const meta = {
  title: "Dashboard/Shell/OrganizationMenuTrigger",
  component: OrganizationMenuTrigger,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: baseArgs,
} satisfies Meta<typeof OrganizationMenuTrigger>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isMenuOpen: true,
  },
};

export const WithError: Story = {
  args: {
    isMenuOpen: true,
    organizationSummaryErrorMessage: "Organization details could not be loaded.",
  },
};

export const MultiOrganizationSwitcher: Story = {
  args: {
    isMenuOpen: true,
    isSwitchOrganizationSubmenuOpen: true,
    organizations: [
      { id: "org_acme", name: "Acme Corp" },
      { id: "org_mistle", name: "Mistle Labs" },
      { id: "org_northstar", name: "Northstar Research" },
    ],
  },
};

export const OrganizationListFailureWithCachedOptions: Story = {
  args: {
    isMenuOpen: true,
    isSwitchOrganizationSubmenuOpen: true,
    organizationSwitcherErrorMessage: "Unable to load organizations.",
    organizations: [
      { id: "org_mistle", name: "Mistle Labs" },
      { id: "org_northstar", name: "Northstar Research" },
    ],
  },
};

export const OrganizationListFailureWithoutOptions: Story = {
  args: {
    isMenuOpen: true,
    isSwitchOrganizationSubmenuOpen: true,
    organizationSwitcherErrorMessage: "Unable to load organizations.",
    organizations: [],
  },
};

export const SigningOut: Story = {
  args: {
    isMenuOpen: true,
    isSigningOut: true,
  },
};
