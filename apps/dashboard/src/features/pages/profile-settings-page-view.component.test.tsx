// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

const baseProps = {
  appearance: "system",
  displayName: "Mistle Developer",
  email: "developer@mistle.so",
  imageUrl: null,
  pendingLinkedAccountConfigIds: [],
  linkedAccountCallbackNotice: null,
  linkedAccountCards: [],
  linkedAccountErrorMessage: null,
  linkedAccountsEmptyStateMessage: null,
  linkedAccountsLoading: false,
  linkedAccountsLoadErrorMessage: null,
  onCheckLinkedAccountCommitSigningKey: async () => ({
    status: "registered",
    publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMistle",
    publicKeyFingerprint: "SHA256:mistle",
  }),
  onDeleteLinkedAccountCommitSigningKey: async () => {},
  onDeleteProfileImage: async () => {},
  onLinkLinkedAccount: async () => {},
  onSaveAppearance: async () => {},
  onSaveChanges: async () => {},
  onUnlinkLinkedAccount: async () => {},
  onUpdateLinkedAccountPreferredEmail: async () => {},
  onUploadLinkedAccountCommitSigningKey: async () => {},
  onUploadProfileImage: async () => {},
  profileImageBusy: false,
  profileImageErrorMessage: null,
  saving: false,
  updatingAppearance: false,
} satisfies React.ComponentProps<typeof ProfileSettingsPageView>;

type LinkedAccountCard = NonNullable<
  React.ComponentProps<typeof ProfileSettingsPageView>["linkedAccountCards"]
>[number];

function createGitHubLinkedCard(overrides: Partial<LinkedAccountCard> = {}): LinkedAccountCard {
  return {
    organizationProviderConfigId: "ilp_component_github",
    providerFamily: "github",
    displayName: "GitHub",
    configurationLabel: "mistle · GitHub App installation",
    logoKey: "github",
    statusLabel: "Linked",
    statusTone: "active",
    accountLabel: "@mistle-user",
    helperMessage: null,
    emailPreference: null,
    commitSigning: null,
    primaryActionLabel: null,
    secondaryActionLabel: "Unlink",
    ...overrides,
  };
}

function createGitHubSigningNotConfiguredCard(
  overrides: Partial<LinkedAccountCard> = {},
): LinkedAccountCard {
  return createGitHubLinkedCard({
    commitSigning: {
      statusLabel: "Add private key",
      keySummaryLabel: null,
      uploadActionLabel: "Upload private key",
      removeActionLabel: null,
    },
    ...overrides,
  });
}

function createSlackLinkedCard(overrides: Partial<LinkedAccountCard> = {}): LinkedAccountCard {
  return {
    organizationProviderConfigId: "ilp_component_slack",
    providerFamily: "slack",
    displayName: "Slack",
    configurationLabel: "Mistle Engineering · Slack app",
    logoKey: "slack",
    statusLabel: "Linked",
    statusTone: "active",
    accountLabel: "Mistle Slack User",
    helperMessage: null,
    emailPreference: null,
    commitSigning: null,
    primaryActionLabel: null,
    secondaryActionLabel: "Unlink",
    ...overrides,
  };
}

describe("ProfileSettingsPageView", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows edit and remove actions when a profile image is available", () => {
    render(<ProfileSettingsPageView {...baseProps} imageUrl="https://example.com/avatar.webp" />);

    expect(screen.getByRole("button", { name: "Edit profile image" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove profile image" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("saves the selected appearance preference", async () => {
    const savedAppearances: string[] = [];

    render(
      <ProfileSettingsPageView
        {...baseProps}
        onSaveAppearance={async (appearance) => {
          savedAppearances.push(appearance);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Appearance" }));
    const darkOption = screen.getByRole("option", { name: "Dark" });
    fireEvent.mouseMove(darkOption);
    fireEvent.mouseDown(darkOption, { button: 0 });
    fireEvent.mouseUp(darkOption, { button: 0 });
    fireEvent.click(darkOption, { button: 0 });

    await waitFor(() => {
      expect(savedAppearances).toEqual(["dark"]);
    });
  });

  it("uploads and removes the profile image through the provided handlers", async () => {
    const uploadedFiles: File[] = [];
    let removeCount = 0;
    let finishUpload: (() => void) | undefined;

    function createDeferredPromise<T>() {
      let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;

      const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
      });

      if (resolvePromise === undefined) {
        throw new Error("Expected deferred promise resolver to be initialized.");
      }

      return {
        promise,
        resolve: resolvePromise,
      };
    }

    function Harness(): React.JSX.Element {
      const [imageUrl, setImageUrl] = useState<string | null>(null);
      const [busy, setBusy] = useState(false);

      return (
        <ProfileSettingsPageView
          {...baseProps}
          imageUrl={imageUrl}
          onDeleteProfileImage={async () => {
            removeCount += 1;
            setImageUrl(null);
          }}
          onUploadProfileImage={async (file) => {
            uploadedFiles.push(file);
            setBusy(true);
            const deferred = createDeferredPromise<void>();
            finishUpload = () => {
              setImageUrl("https://example.com/updated.webp");
              setBusy(false);
              deferred.resolve(undefined);
            };
            await deferred.promise;
          }}
          profileImageBusy={busy}
        />
      );
    }

    render(<Harness />);

    const uploadInput = screen.getByLabelText("Upload profile image", {
      selector: "input",
    });
    const uploadFile = new File([new Uint8Array([1, 2, 3])], "avatar.png", { type: "image/png" });

    fireEvent.change(uploadInput, {
      target: {
        files: [uploadFile],
      },
    });

    await waitFor(() => {
      expect(uploadedFiles).toEqual([uploadFile]);
    });

    const completeUpload = finishUpload;
    if (completeUpload === undefined) {
      throw new Error("Expected upload resolver to be captured.");
    }
    completeUpload();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit profile image" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove profile image" }));

    await waitFor(() => {
      expect(removeCount).toBe(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload profile image" })).toBeTruthy();
    });
  });

  it("renders the GitHub linked-account section for an unlinked account", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          {
            organizationProviderConfigId: "ilp_component_github",
            providerFamily: "github",
            displayName: "GitHub",
            configurationLabel: "mistle · GitHub App installation",
            logoKey: "github",
            statusLabel: "Not linked",
            statusTone: "warning",
            accountLabel: "No linked account yet",
            helperMessage: null,
            emailPreference: null,
            commitSigning: null,
            primaryActionLabel: "Link account",
            secondaryActionLabel: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("Linked Accounts")).toBeTruthy();
    expect(screen.getByText("No linked account yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  });

  it("renders linked GitHub account details with only the unlink action", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          createGitHubSigningNotConfiguredCard({
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
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("@mistle-user")).toBeTruthy();
    expect(screen.queryByText("Linked Apr 19, 2026, 6:15 PM")).toBeNull();
    expect(screen.queryByRole("button", { name: "Relink" })).toBeNull();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
  });

  it("hides commit email when GitHub metadata is unavailable", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          createGitHubSigningNotConfiguredCard({
            emailPreference: null,
          }),
        ]}
      />,
    );

    expect(screen.queryByText("Commit email")).toBeNull();
    expect(screen.queryByText("None")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Commit email" })).toBeNull();
  });

  it("renders a callback notice when a linked-account result is present", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCallbackNotice={{
          title: "GitHub linked successfully",
          message: "Your GitHub account is now linked on Mistle.",
          variant: "success",
        }}
      />,
    );

    expect(screen.getByText("GitHub linked successfully")).toBeTruthy();
    expect(screen.getByText("Your GitHub account is now linked on Mistle.")).toBeTruthy();
  });

  it("renders an empty state when no linked account providers are available", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountsEmptyStateMessage={
          "Your organization has not enabled any linked account providers right now."
        }
      />,
    );

    expect(screen.getByText("Linked Accounts")).toBeTruthy();
    expect(
      screen.getByText("Your organization has not enabled any linked account providers right now."),
    ).toBeTruthy();
  });

  it("renders multiple linked-account cards when more than one provider is configured", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          {
            organizationProviderConfigId: "ilp_component_github",
            providerFamily: "github",
            displayName: "GitHub",
            configurationLabel: "mistle · GitHub App installation",
            logoKey: "github",
            statusLabel: "Linked",
            statusTone: "active",
            accountLabel: "@mistle-user",
            helperMessage: null,
            emailPreference: null,
            commitSigning: {
              statusLabel: "Add private key",
              keySummaryLabel: null,
              uploadActionLabel: "Upload private key",
              removeActionLabel: null,
            },
            primaryActionLabel: null,
            secondaryActionLabel: "Unlink",
          },
          {
            organizationProviderConfigId: "ilp_component_slack",
            providerFamily: "slack",
            displayName: "Slack",
            configurationLabel: "Mistle Engineering · Slack app",
            logoKey: "slack",
            statusLabel: "Not linked",
            statusTone: "warning",
            accountLabel: "No linked account yet",
            helperMessage: null,
            emailPreference: null,
            commitSigning: null,
            primaryActionLabel: "Link account",
            secondaryActionLabel: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getByText("mistle · GitHub App installation")).toBeTruthy();
    expect(screen.getByText("Mistle Engineering · Slack app")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link account" })).toBeTruthy();
  });

  it("renders multiple Slack linked-account cards with distinguishable configuration labels", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          createSlackLinkedCard({
            organizationProviderConfigId: "ilp_component_slack_engineering",
            configurationLabel: "Mistle Engineering · Slack app",
            accountLabel: "Engineering User",
          }),
          createSlackLinkedCard({
            organizationProviderConfigId: "ilp_component_slack_support",
            configurationLabel: "Mistle Support · Slack app",
            accountLabel: "Support User",
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Slack")).toHaveLength(2);
    expect(screen.getByText("Mistle Engineering · Slack app")).toBeTruthy();
    expect(screen.getByText("Mistle Support · Slack app")).toBeTruthy();
    expect(screen.getByText("Engineering User")).toBeTruthy();
    expect(screen.getByText("Support User")).toBeTruthy();
  });

  it("only shows linked-account pending state for the config with an in-flight action", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          createSlackLinkedCard({
            organizationProviderConfigId: "ilp_component_slack_engineering",
            configurationLabel: "Mistle Engineering · Slack app",
            statusLabel: "Not linked",
            statusTone: "warning",
            accountLabel: "No linked account yet",
            primaryActionLabel: "Link account",
            secondaryActionLabel: null,
          }),
          createSlackLinkedCard({
            organizationProviderConfigId: "ilp_component_slack_support",
            configurationLabel: "Mistle Support · Slack app",
            statusLabel: "Not linked",
            statusTone: "warning",
            accountLabel: "No linked account yet",
            primaryActionLabel: "Link account",
            secondaryActionLabel: null,
          }),
        ]}
        pendingLinkedAccountConfigIds={["ilp_component_slack_engineering"]}
      />,
    );

    const engineeringCard = screen.getByText("Mistle Engineering · Slack app").closest(".rounded");
    const supportCard = screen.getByText("Mistle Support · Slack app").closest(".rounded");

    if (!(engineeringCard instanceof HTMLElement) || !(supportCard instanceof HTMLElement)) {
      throw new Error("Expected linked account cards to render.");
    }

    expect(
      within(engineeringCard)
        .getByRole("button", { name: "Link account" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      within(supportCard).getByRole("button", { name: "Link account" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("triggers link and unlink handlers through the linked-account actions", async () => {
    let linkCount = 0;
    let unlinkCount = 0;

    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          {
            organizationProviderConfigId: "ilp_component_github",
            providerFamily: "github",
            displayName: "GitHub",
            configurationLabel: "mistle · GitHub App installation",
            logoKey: "github",
            statusLabel: "Relink required",
            statusTone: "warning",
            accountLabel: "@mistle-user",
            helperMessage: null,
            emailPreference: null,
            commitSigning: null,
            primaryActionLabel: "Relink",
            secondaryActionLabel: "Unlink",
          },
        ]}
        onLinkLinkedAccount={async () => {
          linkCount += 1;
        }}
        onUnlinkLinkedAccount={async () => {
          unlinkCount += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Relink" }));
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));

    await waitFor(() => {
      expect(linkCount).toBe(1);
      expect(unlinkCount).toBe(1);
    });
  });

  it("renders account-specific helper messages inside the linked account card", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          {
            organizationProviderConfigId: "ilp_component_github",
            providerFamily: "github",
            displayName: "GitHub",
            configurationLabel: "mistle · GitHub App installation",
            logoKey: "github",
            statusLabel: "Disabled",
            statusTone: "disabled",
            accountLabel: "@mistle-user",
            helperMessage:
              "Your organization has disabled GitHub identity linking. You can still unlink this account.",
            emailPreference: null,
            commitSigning: null,
            primaryActionLabel: null,
            secondaryActionLabel: "Unlink",
          },
        ]}
      />,
    );

    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(
      screen.getByText(
        "Your organization has disabled GitHub identity linking. You can still unlink this account.",
      ),
    ).toBeTruthy();
  });

  it("renders GitHub commit email and signing controls when available", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          {
            organizationProviderConfigId: "ilp_component_github",
            providerFamily: "github",
            displayName: "GitHub",
            configurationLabel: "mistle · GitHub App installation",
            logoKey: "github",
            statusLabel: "Linked",
            statusTone: "active",
            accountLabel: "@mistle-user",
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
            },
            commitSigning: {
              statusLabel: "Private key added",
              keySummaryLabel: "SHA256:abc123",
              uploadActionLabel: "Replace private key",
              removeActionLabel: "Remove key",
            },
            primaryActionLabel: null,
            secondaryActionLabel: "Unlink",
          },
        ]}
      />,
    );

    expect(screen.getByText("Commit email")).toBeTruthy();
    expect(screen.getByText("Commit signing")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Commit email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace private key" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove key" })).toBeTruthy();
    expect(screen.getByText("Private key added")).toBeTruthy();
    expect(screen.queryByText("SSH private key")).toBeNull();
    expect(screen.queryByText("Used for sandbox Git identity and commit signing.")).toBeNull();
  });

  it("disables the GitHub commit email field while linked-account actions are pending", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        pendingLinkedAccountConfigIds={["ilp_component_github"]}
        linkedAccountCards={[
          {
            organizationProviderConfigId: "ilp_component_github",
            providerFamily: "github",
            displayName: "GitHub",
            configurationLabel: "mistle · GitHub App installation",
            logoKey: "github",
            statusLabel: "Linked",
            statusTone: "active",
            accountLabel: "@mistle-user",
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
            },
            commitSigning: null,
            primaryActionLabel: null,
            secondaryActionLabel: "Unlink",
          },
        ]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Commit email" }).hasAttribute("disabled")).toBe(
      true,
    );
  });

  it("uploads a pasted GitHub commit signing key through the provided handler", async () => {
    const uploadedFiles: File[] = [];

    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
        onUploadLinkedAccountCommitSigningKey={async (_providerFamily, file) => {
          uploadedFiles.push(file);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));

    fireEvent.change(screen.getByPlaceholderText("Paste your SSH private key"), {
      target: {
        value: "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check key" }));
    expect(
      await screen.findByText(
        "This private key can sign commits and matches a GitHub SSH signing key.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));

    await waitFor(() => {
      expect(uploadedFiles).toHaveLength(1);
    });
    expect(uploadedFiles[0]?.name).toBe("my-signing-key");
    expect(uploadedFiles[0]?.type).toBe("text/plain");
  });

  it("shows local generation help in the GitHub commit signing dialog", async () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));
    fireEvent.click(screen.getByRole("button", { name: "Show helper" }));

    expect(screen.getByText('ssh-keygen -t ed25519 -N "" -f ~/.ssh/mistle-signing')).toBeTruthy();
    expect(
      screen.getByText("gh ssh-key add ~/.ssh/mistle-signing.pub --type signing"),
    ).toBeTruthy();
    expect(screen.getByText("Generate a SSH signing key with no passphrase")).toBeTruthy();
    expect(screen.getByText(/Add the public key via/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "GitHub settings" }).getAttribute("href")).toBe(
      "https://github.com/settings/keys",
    );
  });

  it("resets local generation help when the GitHub commit signing dialog closes", async () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));
    fireEvent.click(screen.getByRole("button", { name: "Show helper" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));

    expect(screen.getByRole("button", { name: "Show helper" })).toBeTruthy();
    expect(screen.queryByText('ssh-keygen -t ed25519 -N "" -f ~/.ssh/mistle-signing')).toBeNull();
  });

  it("loads and uploads a GitHub commit signing key from the file chooser after checking it", async () => {
    const uploadedFiles: File[] = [];

    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
        onUploadLinkedAccountCommitSigningKey={async (_providerFamily, file) => {
          uploadedFiles.push(file);
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));

    const uploadInput = screen.getByLabelText("Choose GitHub commit signing private key file", {
      selector: "input",
    });
    const uploadFile = new File(
      ["-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----\n"],
      "my-signing-key",
      {
        type: "application/octet-stream",
      },
    );

    fireEvent.change(uploadInput, {
      target: {
        files: [uploadFile],
      },
    });

    expect(await screen.findByText("Selected file: my-signing-key")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check key" }));
    expect(
      await screen.findByText(
        "This private key can sign commits and matches a GitHub SSH signing key.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));

    await waitFor(() => {
      expect(uploadedFiles).toHaveLength(1);
    });
    expect(uploadedFiles).toEqual([uploadFile]);
  });

  it("shows a dialog error when a pasted GitHub commit signing key check fails", async () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
        onCheckLinkedAccountCommitSigningKey={async () => {
          throw new Error("Invalid private key.");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));
    fireEvent.change(screen.getByPlaceholderText("Paste your SSH private key"), {
      target: {
        value: "-----BEGIN OPENSSH PRIVATE KEY-----\ninvalid\n-----END OPENSSH PRIVATE KEY-----\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check key" }));

    expect(await screen.findByText("Invalid private key.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("keeps saving disabled when GitHub does not have the pasted signing key", async () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
        onCheckLinkedAccountCommitSigningKey={async () => ({
          status: "not_registered",
          publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMistle",
          publicKeyFingerprint: "SHA256:mistle",
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));
    fireEvent.change(screen.getByPlaceholderText("Paste your SSH private key"), {
      target: {
        value: "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----\n",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check key" }));

    expect(
      await screen.findByText(
        "This private key can sign commits, but its public key is not registered as a GitHub signing key.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add private key" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
