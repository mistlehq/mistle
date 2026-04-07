// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ProfileSettingsPageView } from "./profile-settings-page-view.js";

describe("ProfileSettingsPageView", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows edit and remove actions when a profile image is available", () => {
    render(
      <ProfileSettingsPageView
        displayName="Mistle Developer"
        email="developer@mistle.so"
        imageUrl="https://example.com/avatar.webp"
        onDeleteProfileImage={async () => {}}
        onSaveChanges={async () => {}}
        onUploadProfileImage={async () => {}}
        profileImageBusy={false}
        profileImageErrorMessage={null}
        saving={false}
      />,
    );

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
          displayName="Mistle Developer"
          email="developer@mistle.so"
          imageUrl={imageUrl}
          onDeleteProfileImage={async () => {
            removeCount += 1;
            setImageUrl(null);
          }}
          onSaveChanges={async () => {}}
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
          profileImageErrorMessage={null}
          saving={false}
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
});
