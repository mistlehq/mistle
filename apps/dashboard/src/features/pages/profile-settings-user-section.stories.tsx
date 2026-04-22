import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  ProfileSettingsUserSection,
  type ProfileSettingsUserSectionProps,
} from "./profile-settings-page-view.js";
import { DefaultProfileSettingsUserSectionProps } from "./profile-settings-page-view.story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/Profile/User",
  component: ProfileSettingsUserSection,
  decorators: [withDashboardPageStory],
  render: (args) => <ProfileSettingsUserSection {...args} />,
  args: DefaultProfileSettingsUserSectionProps,
} satisfies Meta<ProfileSettingsUserSectionProps>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAvatar: Story = {
  args: {
    imageUrl: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=256&h=256&fit=crop",
  },
};

export const Busy: Story = {
  args: {
    profileImageBusy: true,
    saving: true,
  },
};

export const ProfileImageError: Story = {
  args: {
    profileImageErrorMessage: "Could not upload profile image.",
  },
};
