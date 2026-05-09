import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  ProfileSettingsPageView,
  type ProfileSettingsPageViewProps,
} from "./profile-settings-page-view.js";
import {
  GitHubLinkedWithConfiguredSigningCard,
  DefaultProfileSettingsPageViewProps,
} from "./profile-settings-page-view.story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/My Profile/PageView",
  component: ProfileSettingsPageView,
  decorators: [withDashboardPageStory],
  render: (args) => <ProfileSettingsPageView {...args} />,
  args: DefaultProfileSettingsPageViewProps,
} satisfies Meta<ProfileSettingsPageViewProps>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithConfiguredSigningCard],
  },
};
