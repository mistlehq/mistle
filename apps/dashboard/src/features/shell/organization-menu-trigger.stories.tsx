import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { OrganizationMenuTrigger } from "./organization-menu-trigger.js";

const meta = {
  title: "Dashboard/Shell/OrganizationMenuTrigger",
  component: OrganizationMenuTrigger,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
  args: {
    organizationName: "Mistle Labs",
    organizationErrorMessage: null,
    isSigningOut: false,
    onNavigateToSettings: function onNavigateToSettings() {},
    onSignOut: function onSignOut() {},
  },
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
    organizationErrorMessage: "Organization details could not be loaded.",
  },
};

export const SigningOut: Story = {
  args: {
    isSigningOut: true,
  },
};
