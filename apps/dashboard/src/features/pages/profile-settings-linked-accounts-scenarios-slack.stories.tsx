import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import {
  ProfileSettingsLinkedAccountsSection,
  type ProfileSettingsLinkedAccountsSectionProps,
} from "./profile-settings-page-view.js";
import {
  DefaultProfileSettingsLinkedAccountsSectionProps,
  SlackDisabledButStillLinkedCard,
  SlackLinkedCard,
  SlackNotLinkedCard,
  SlackRelinkRequiredCard,
} from "./profile-settings-page-view.story-fixtures.js";

const meta = {
  title: "Dashboard/Settings/My Profile/Linked Accounts/Scenarios/Slack",
  component: ProfileSettingsLinkedAccountsSection,
  decorators: [withDashboardPageStory],
  render: (args) => <ProfileSettingsLinkedAccountsSection {...args} />,
  args: DefaultProfileSettingsLinkedAccountsSectionProps,
} satisfies Meta<ProfileSettingsLinkedAccountsSectionProps>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Linked: Story = {
  args: {
    linkedAccountCards: [SlackLinkedCard],
  },
};

export const NotLinked: Story = {
  args: {
    linkedAccountCards: [SlackNotLinkedCard],
  },
};

export const RelinkRequired: Story = {
  args: {
    linkedAccountCards: [SlackRelinkRequiredCard],
  },
};

export const DisabledButStillLinked: Story = {
  args: {
    linkedAccountCards: [SlackDisabledButStillLinkedCard],
  },
};
