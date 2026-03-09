import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { createDashboardMemoryRouterDecorator } from "../../storybook/decorators.js";
import { SettingsShellView } from "./settings-shell-view.js";
import {
  createSettingsShellStoryArgs,
  SettingsShellStoryForLocation,
  SettingsStoryPathnames,
} from "./settings-story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/SettingsShellView",
  component: SettingsShellView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [createDashboardMemoryRouterDecorator()],
  args: createSettingsShellStoryArgs(SettingsStoryPathnames.ACCOUNT_PROFILE),
} satisfies Meta<typeof SettingsShellView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Profile: Story = {};

export const OrganizationGeneral: Story = {
  args: {
    ...createSettingsShellStoryArgs(SettingsStoryPathnames.ORGANIZATION_GENERAL),
  },
};

export const OrganizationMembers: Story = {
  args: {
    ...createSettingsShellStoryArgs(SettingsStoryPathnames.ORGANIZATION_MEMBERS),
  },
};

export const InteractiveNavigation: Story = {
  decorators: [createDashboardMemoryRouterDecorator([SettingsStoryPathnames.ACCOUNT_PROFILE])],
  render: SettingsShellStoryForLocation,
  play: async ({ canvasElement }): Promise<void> => {
    const body = within(canvasElement.ownerDocument.body);

    await expect(body.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(body.getByLabelText("Display name")).toBeVisible();

    await userEvent.click(body.getByRole("link", { name: "General" }));
    await expect(body.getByRole("heading", { name: "General" })).toBeVisible();
    await expect(body.getByLabelText("Organization name")).toBeVisible();

    await userEvent.click(body.getByRole("link", { name: "Members" }));
    await expect(body.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(body.getByRole("button", { name: "Invite members" })).toBeVisible();
    await expect(body.getByText("owner@mistle.so")).toBeVisible();

    await userEvent.click(body.getByRole("link", { name: "Profile" }));
    await expect(body.getByRole("heading", { name: "Profile" })).toBeVisible();
    await expect(body.getByDisplayValue("Mistle Developer")).toBeVisible();
  },
};
