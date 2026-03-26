import type { Meta, StoryObj } from "@storybook/react-vite";

import { createDashboardMemoryRouterDecorator } from "../../storybook/decorators.js";
import {
  createOrganizationGeneralSettingsFixtureContent,
  createOrganizationMembersSettingsFixtureContent,
  createProfileSettingsFixtureContent,
  createSettingsFixtureInviteMembersButton,
} from "./settings-fixtures.js";
import { SettingsShellView } from "./settings-shell-view.js";

function createStoryBreadcrumb(text: string): React.JSX.Element {
  return <p className="truncate text-sm">{text}</p>;
}

function createProfileStoryArgs(): React.ComponentProps<typeof SettingsShellView> {
  return {
    backLabel: "Back",
    breadcrumbs: createStoryBreadcrumb("Settings / Profile"),
    content: createProfileSettingsFixtureContent(),
    headerActions: null,
    layoutVariant: "form",
    onBack: () => {},
    pathname: "/settings/account/profile",
    showBreadcrumbs: true,
    supportingText: "",
    title: "Profile",
  };
}

function createOrganizationGeneralStoryArgs(): React.ComponentProps<typeof SettingsShellView> {
  return {
    backLabel: "Back",
    breadcrumbs: createStoryBreadcrumb("Settings / Organization / General"),
    content: createOrganizationGeneralSettingsFixtureContent(),
    headerActions: null,
    layoutVariant: "form",
    onBack: () => {},
    pathname: "/settings/organization/general",
    showBreadcrumbs: true,
    supportingText: "",
    title: "General",
  };
}

function createOrganizationMembersStoryArgs(): React.ComponentProps<typeof SettingsShellView> {
  return {
    backLabel: "Back",
    breadcrumbs: createStoryBreadcrumb("Settings / Organization / Members"),
    content: createOrganizationMembersSettingsFixtureContent(),
    headerActions: createSettingsFixtureInviteMembersButton(),
    layoutVariant: "default",
    onBack: () => {},
    pathname: "/settings/organization/members",
    showBreadcrumbs: true,
    supportingText: "",
    title: "Members",
  };
}

const meta = {
  title: "Dashboard/Settings/SettingsShellView",
  component: SettingsShellView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [createDashboardMemoryRouterDecorator()],
  args: createProfileStoryArgs(),
} satisfies Meta<typeof SettingsShellView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Profile: Story = {};

export const OrganizationGeneral: Story = {
  args: {
    ...createOrganizationGeneralStoryArgs(),
  },
};

export const OrganizationMembers: Story = {
  args: {
    ...createOrganizationMembersStoryArgs(),
  },
};
