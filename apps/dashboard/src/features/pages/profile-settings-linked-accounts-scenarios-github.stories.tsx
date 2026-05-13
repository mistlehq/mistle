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
  title: "Dashboard/Settings/My Profile/Linked Accounts/Scenarios/GitHub",
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

export const SigningCheckFailureDialog: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard],
    onCheckLinkedAccountCommitSigningKey: async () => {
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
    await userEvent.click(canvas.getByRole("button", { name: "Check key" }));

    await expect(canvas.getByText("Invalid private key.")).toBeTruthy();
  },
};

export const SigningNotRegisteredDialog: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard],
    onCheckLinkedAccountCommitSigningKey: async () => ({
      status: "not_registered",
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMistle",
      publicKeyFingerprint: "SHA256:mistle",
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Add private key" }));
    await userEvent.type(
      canvas.getByPlaceholderText("Paste your SSH private key"),
      "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----\n",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Check key" }));

    await expect(
      canvas.getByText(
        "This private key can sign commits, but its public key is not registered as a GitHub signing key.",
      ),
    ).toBeTruthy();
    await expect(canvas.getByRole("button", { name: "Add private key" })).toBeDisabled();
  },
};

export const SigningLocalGenerationHelperDialog: Story = {
  args: {
    linkedAccountCards: [GitHubLinkedWithSigningNotConfiguredCard],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Add private key" }));
    await userEvent.click(canvas.getByRole("button", { name: "Show helper" }));

    await expect(canvas.queryByText("Need a new signing key?")).toBeNull();
    await expect(canvas.getByText("Generate a SSH signing key with no passphrase")).toBeTruthy();
    await expect(canvas.getByText(/Add the public key via/)).toBeTruthy();
    await expect(
      canvas.getByText('ssh-keygen -t ed25519 -N "" -f ~/.ssh/mistle-signing'),
    ).toBeTruthy();
    await expect(canvas.getByRole("link", { name: "GitHub settings" })).toBeTruthy();
    await expect(
      canvas.getByText("gh ssh-key add ~/.ssh/mistle-signing.pub --type signing"),
    ).toBeTruthy();
  },
};
