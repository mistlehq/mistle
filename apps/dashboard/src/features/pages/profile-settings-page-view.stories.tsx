import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  ProfileSettingsPageView,
  type ProfileSettingsPageViewProps,
} from "./profile-settings-page-view.js";

const DefaultProps: ProfileSettingsPageViewProps = {
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
  onUpdateLinkedAccountPreferredEmail: async () => {},
  onUploadProfileImage: async () => {},
  profileImageBusy: false,
  profileImageErrorMessage: null,
  saving: false,
};

const meta = {
  title: "Dashboard/Settings/Profile/PageView",
  component: ProfileSettingsPageView,
  decorators: [withDashboardPageStory],
  render: (args) => <ProfileSettingsPageView {...args} />,
  args: DefaultProps,
} satisfies Meta<ProfileSettingsPageViewProps>;

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
        emailPreference: {
          selectedEmail: "mistle-user@example.com",
          options: [
            {
              value: "mistle-user@example.com",
              label: "mistle-user@example.com (Primary)",
            },
            {
              value: "engineering@example.com",
              label: "engineering@example.com",
            },
          ],
          helperText: "Used for sandbox Git identity and commit signing.",
        },
        primaryActionLabel: "Relink",
        secondaryActionLabel: "Unlink",
      },
    ],
  },
};
