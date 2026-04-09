import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { expect, userEvent, within } from "storybook/test";

import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

const baseArgs = {
  activeOrganizationId: "org_mistle",
  isSwitchingOrganization: false,
  organizationName: "Mistle Labs",
  organizationImageUrl: null,
  organizationSummaryErrorMessage: null,
  organizationSwitcherErrorMessage: null,
  organizations: [],
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
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Organization menu" }));

    await expect(await canvas.findByText("Settings")).toBeVisible();
    await expect(await canvas.findByText("Sign out")).toBeVisible();
  },
};

export const WithError: Story = {
  args: {
    organizationSummaryErrorMessage: "Organization details could not be loaded.",
  },
};

export const WithLogo: Story = {
  args: {
    organizationImageUrl: "https://images.example.com/mistle-logo.webp",
  },
};

export const MultiOrganizationSwitcher: Story = {
  args: {
    organizations: [
      { id: "org_acme", name: "Acme Corp" },
      { id: "org_mistle", name: "Mistle Labs" },
      { id: "org_northstar", name: "Northstar Research" },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Organization menu" }));
    await expect(await canvas.findByText("Switch organization")).toBeVisible();
  },
};

export const OrganizationListFailureWithCachedOptions: Story = {
  args: {
    organizationSwitcherErrorMessage: "Unable to load organizations.",
    organizations: [
      { id: "org_mistle", name: "Mistle Labs" },
      { id: "org_northstar", name: "Northstar Research" },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Organization menu" }));
    await userEvent.click(await canvas.findByText("Switch organization"));

    await expect(await canvas.findByText("Unable to load organizations.")).toBeVisible();
    await expect(await canvas.findByText("Northstar Research")).toBeVisible();
  },
};

export const OrganizationListFailureWithoutOptions: Story = {
  args: {
    organizationSwitcherErrorMessage: "Unable to load organizations.",
    organizations: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Organization menu" }));
    await userEvent.click(await canvas.findByText("Switch organization"));

    await expect(await canvas.findByText("Unable to load organizations.")).toBeVisible();
  },
};

export const SigningOut: Story = {
  args: {
    isSigningOut: true,
  },
};
