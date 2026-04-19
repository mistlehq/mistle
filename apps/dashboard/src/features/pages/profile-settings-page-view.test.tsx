// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

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
  onDeleteProfileImage: async () => {},
  onLinkLinkedAccount: async () => {},
  onSaveChanges: async () => {},
  onUnlinkLinkedAccount: async () => {},
  onUploadProfileImage: async () => {},
  profileImageBusy: false,
  profileImageErrorMessage: null,
  saving: false,
} satisfies React.ComponentProps<typeof ProfileSettingsPageView>;

describe("ProfileSettingsPageView", () => {
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
            linkedAtLabel: null,
            helperMessage: null,
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

  it("renders linked GitHub account details with relink and unlink actions", () => {
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
            linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
            helperMessage: null,
            primaryActionLabel: "Relink",
            secondaryActionLabel: "Unlink",
          },
        ]}
      />,
    );

    expect(screen.getByText("@mistle-user")).toBeTruthy();
    expect(screen.getByText("Linked Apr 19, 2026, 6:15 PM")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Relink" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlink" })).toBeTruthy();
  });

  it("renders a callback notice when a linked-account result is present", () => {
    render(
      <ProfileSettingsPageView
        {...baseProps}
        linkedAccountCallbackNotice={{
          title: "GitHub linked",
          message: "Your GitHub account is now linked to Mistle.",
          variant: "default",
        }}
      />,
    );

    expect(screen.getByText("GitHub linked")).toBeTruthy();
    expect(screen.getByText("Your GitHub account is now linked to Mistle.")).toBeTruthy();
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
            linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
            helperMessage: null,
            primaryActionLabel: "Relink",
            secondaryActionLabel: "Unlink",
          },
          {
            providerFamily: "slack",
            displayName: "Slack",
            logoKey: "slack",
            statusLabel: "Not linked",
            statusTone: "warning",
            accountLabel: "No linked account yet",
            linkedAtLabel: null,
            helperMessage: null,
            primaryActionLabel: "Link account",
            secondaryActionLabel: null,
          },
        ]}
      />,
    );

    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Relink" })).toBeTruthy();
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
            linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
            helperMessage: "GitHub needs to be linked again before Mistle can act as you.",
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
});
