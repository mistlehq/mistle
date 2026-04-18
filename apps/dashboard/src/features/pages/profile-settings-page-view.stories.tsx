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
    linkedAccountActionPending: false,
    linkedAccountCallbackNotice: null,
    linkedAccountCard: null,
    linkedAccountErrorMessage: null,
    linkedAccountsEmptyStateMessage: null,
    linkedAccountsLoading: false,
    linkedAccountsLoadErrorMessage: null,
    onDeleteProfileImage: async () => {},
    onLinkLinkedAccount: async () => {},
    onSaveChanges: async () => {},
    onUnlinkLinkedAccount: async () => {},
    onUploadProfileImage: async () => {},
    profileImageBusy: false,
    profileImageErrorMessage: null,
    saving: false,
  },
} satisfies Meta<typeof ProfileSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithGitHubLinkedAccount: Story = {
  args: {
    linkedAccountCard: {
      providerFamily: "github",
      displayName: "GitHub",
      logoKey: "github",
      statusLabel: "Linked",
      statusTone: "active",
      accountLabel: "@mistle-user",
      linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
      helperMessage: null,
      primaryActionLabel: "Relink",
      secondaryActionLabel: "Unlink",
    },
  },
};
