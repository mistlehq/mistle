import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

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

export const SigningUploadFailureDialog: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard],
    onUploadLinkedAccountCommitSigningKey: async () => {
      throw new Error("Invalid private key.");
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Add private key" }));
    await userEvent.type(
      canvas.getByPlaceholderText("Paste your SSH private key"),
      "-----BEGIN OPENSSH PRIVATE KEY-----\ninvalid\n-----END OPENSSH PRIVATE KEY-----\n",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Upload private key" }));

    await expect(canvas.getByText("Invalid private key.")).toBeTruthy();
  },
};
