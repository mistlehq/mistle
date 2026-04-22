// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

const baseProps = {
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
  onDeleteLinkedAccountCommitSigningKey: async () => {},
  onDeleteProfileImage: async () => {},
  onLinkLinkedAccount: async () => {},
  onSaveChanges: async () => {},
  onUnlinkLinkedAccount: async () => {},
  onUpdateLinkedAccountPreferredEmail: async () => {},
  onUploadLinkedAccountCommitSigningKey: async () => {},
  onUploadProfileImage: async () => {},
  profileImageBusy: false,
  profileImageErrorMessage: null,
  saving: false,
} satisfies React.ComponentProps<typeof ProfileSettingsPageView>;

type LinkedAccountCard = NonNullable<
  React.ComponentProps<typeof ProfileSettingsPageView>["linkedAccountCards"]
>[number];

function createGitHubLinkedCard(overrides: Partial<LinkedAccountCard> = {}): LinkedAccountCard {
  return {
    providerFamily: "github",
    displayName: "GitHub",
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
            providerFamily: "github",
            displayName: "GitHub",
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
    expect(screen.queryByRole("combobox")).toBeNull();
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
            providerFamily: "github",
            displayName: "GitHub",
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
            providerFamily: "slack",
            displayName: "Slack",
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
    expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link account" })).toBeTruthy();
  });

  it("triggers link and unlink handlers through the linked-account actions", async () => {
    let linkCount = 0;
    let unlinkCount = 0;

    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[
          {
            providerFamily: "github",
            displayName: "GitHub",
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
            providerFamily: "github",
            displayName: "GitHub",
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
            providerFamily: "github",
            displayName: "GitHub",
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
    expect(screen.getByRole("combobox")).toBeTruthy();
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
        linkedAccountActionPending={true}
        linkedAccountCards={[
          {
            providerFamily: "github",
            displayName: "GitHub",
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

    expect(screen.getByRole("combobox", { name: "Commit email" })).toHaveProperty("disabled", true);
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
    fireEvent.click(screen.getByRole("button", { name: "Upload private key" }));

    await waitFor(() => {
      expect(uploadedFiles).toHaveLength(1);
    });
    expect(uploadedFiles[0]?.name).toBe("my-signing-key");
    expect(uploadedFiles[0]?.type).toBe("text/plain");
  });

  it("uploads a GitHub commit signing key from the file chooser", async () => {
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

    await waitFor(() => {
      expect(uploadedFiles).toEqual([uploadFile]);
    });
  });

  it("shows a dialog error when a pasted GitHub commit signing key upload fails", async () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
        onUploadLinkedAccountCommitSigningKey={async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Upload private key" }));

    expect(await screen.findByText("Invalid private key.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows a dialog error when a file-based GitHub commit signing key upload fails", async () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCards={[createGitHubSigningNotConfiguredCard()]}
        onUploadLinkedAccountCommitSigningKey={async () => {
          throw new Error("Upload failed.");
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add private key" }));

    const uploadInput = screen.getByLabelText("Choose GitHub commit signing private key file", {
      selector: "input",
    });
    const uploadFile = new File(["bad"], "bad-key", {
      type: "application/octet-stream",
    });

    fireEvent.change(uploadInput, {
      target: {
        files: [uploadFile],
      },
    });

    expect(await screen.findByText("Upload failed.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
