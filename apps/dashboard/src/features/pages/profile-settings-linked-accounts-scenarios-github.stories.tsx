import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  ProfileSettingsLinkedAccountsSection,
  type ProfileSettingsLinkedAccountsSectionProps,
} from "./profile-settings-page-view.js";
import {
  DefaultProfileSettingsLinkedAccountsSectionProps,
  GitHubDisabledButStillLinkedCard,
  GitHubLinkedWithConfiguredSigningCard,
  GitHubLinkedWithSigningNotConfiguredCard,
  GitHubLinkedWithoutSelectableEmailsCard,
  GitHubNotLinkedCard,
  GitHubRelinkRequiredCard,
} from "./profile-settings-page-view.story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/Profile/Linked Accounts/Scenarios/GitHub",
  component: ProfileSettingsLinkedAccountsSection,
  decorators: [withDashboardPageStory],
  render: (args) => <ProfileSettingsLinkedAccountsSection {...args} />,
  args: DefaultProfileSettingsLinkedAccountsSectionProps,
} satisfies Meta<ProfileSettingsLinkedAccountsSectionProps>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithConfiguredSigningCard],
  },
};

export const NotLinked: Story = {
  args: {
    linkedAccountCards: [GitHubNotLinkedCard],
  },
};

export const RelinkRequired: Story = {
  args: {
    linkedAccountCards: [GitHubRelinkRequiredCard],
  },
};

export const LinkedNoSelectableEmails: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithoutSelectableEmailsCard],
  },
};

export const LinkedSigningNotConfigured: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard],
  },
};

export const DisabledButStillLinked: Story = {
  args: {
    linkedAccountCards: [GitHubDisabledButStillLinkedCard],
  },
};
