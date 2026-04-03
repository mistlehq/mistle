import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

const meta = {
  title: "Dashboard/Pages/ProfileSettingsPageView",
  component: ProfileSettingsPageView,
  decorators: [withDashboardPageWidth],
  args: {
    displayName: "Mistle Developer",
    email: "developer@mistle.so",
    fieldError: null,
    onSaveChanges: async () => {},
    saving: false,
  },
} satisfies Meta<typeof ProfileSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Saving: Story = {
  args: {
    displayName: "Mistle Dashboard Team",
    saving: true,
  },
};

export const SaveError: Story = {
  args: {
    displayName: "Mistle Dashboard Team",
    fieldError: "Could not update profile.",
  },
};
