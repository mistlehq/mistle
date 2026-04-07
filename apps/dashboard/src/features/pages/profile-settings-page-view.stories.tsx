import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

const meta = {
  title: "Dashboard/Settings/Profile/PageView",
  component: ProfileSettingsPageView,
  decorators: [withDashboardPageStory],
  args: {
    displayName: "Mistle Developer",
    email: "developer@mistle.so",
    imageUrl: null,
    onDeleteProfileImage: async () => {},
    onSaveChanges: async () => {},
    onUploadProfileImage: async () => {},
    profileImageBusy: false,
    profileImageErrorMessage: null,
    saving: false,
  },
} satisfies Meta<typeof ProfileSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
