import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  ProfileSettingsLinkedAccountsSection,
  type ProfileSettingsLinkedAccountsSectionProps,
} from "./profile-settings-page-view.js";
import {
  DefaultProfileSettingsLinkedAccountsSectionProps,
  GitHubLinkedWithConfiguredSigningCard,
  GitHubLinkedWithSigningNotConfiguredCard,
  GitHubNotLinkedCard,
  SlackNotLinkedCard,
} from "./profile-settings-page-view.story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/Profile/Linked Accounts",
  component: ProfileSettingsLinkedAccountsSection,
  decorators: [withDashboardPageStory],
  render: (args) => <ProfileSettingsLinkedAccountsSection {...args} />,
  args: DefaultProfileSettingsLinkedAccountsSectionProps,
} satisfies Meta<ProfileSettingsLinkedAccountsSectionProps>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithConfiguredSigningCard],
  },
};

export const MultipleProvidersMixedStates: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard, SlackNotLinkedCard],
  },
};

export const Loading: Story = {
  args: {
    linkedAccountsLoading: true,
  },
};

export const LoadError: Story = {
  args: {
    linkedAccountsLoadErrorMessage: "Could not load linked accounts.",
  },
};

export const Empty: Story = {
  args: {
    linkedAccountsEmptyStateMessage:
      "Your organization has not enabled any linked account providers right now.",
  },
};

export const CallbackSuccess: Story = {
  args: {
    linkedAccountCallbackNotice: {
      title: "GitHub linked successfully",
      message: "Your GitHub account is now linked on Mistle.",
      variant: "success",
    },
    linkedAccountCards: [GitHubLinkedWithConfiguredSigningCard],
  },
};

export const CallbackFailure: Story = {
  args: {
    linkedAccountCallbackNotice: {
      title: "GitHub link failed",
      message: "This GitHub linking attempt expired. Start the link again.",
      variant: "alert",
    },
    linkedAccountCards: [GitHubNotLinkedCard],
  },
};

export const OperationError: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithConfiguredSigningCard],
    linkedAccountErrorMessage: "Could not unlink linked account.",
  },
};

export const ActionPending: Story = {
  args: {
    pendingLinkedAccountProviderFamilies: ["github"],
    linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard],
  },
};
