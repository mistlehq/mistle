import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

type ProfileSettingsPageViewStoryArgs = Partial<ComponentProps<typeof ProfileSettingsPageView>>;

const DefaultProps: ComponentProps<typeof ProfileSettingsPageView> = {
  displayName: "Mistle Developer",
  email: "developer@mistle.so",
  imageUrl: null,
  linkedAccountActionPending: false,
  linkedAccountCallbackNotice: null,
  linkedAccountCards: [],
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
};

const meta = {
  title: "Dashboard/Settings/Profile/PageView",
  component: ProfileSettingsPageView,
  decorators: [withDashboardPageStory],
  render: (args) => <ProfileSettingsPageView {...DefaultProps} {...args} />,
  args: {
    displayName: "Mistle Developer",
    email: "developer@mistle.so",
  },
} satisfies Meta<ProfileSettingsPageViewStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithGitHubLinkedAccount: Story = {
  args: {
    linkedAccountCards: [
      {
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
    ],
  },
};
