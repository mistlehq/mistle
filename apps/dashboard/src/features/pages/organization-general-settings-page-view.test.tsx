// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { OrganizationGeneralSettingsPageView } from "./organization-general-settings-page-view.js";

describe("OrganizationGeneralSettingsPageView", () => {
  it("shows edit and remove actions when an organization logo is available", () => {
    render(
      <OrganizationGeneralSettingsPageView
        isLoading={false}
        isSaving={false}
        loadErrorMessage={null}
        logoBusy={false}
        logoErrorMessage={null}
        logoUrl="https://example.com/logo.webp"
        name="Mistle"
        onDeleteLogo={async () => {}}
        onSaveChanges={async () => {}}
        onUploadLogo={async () => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Edit organization logo" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove organization logo" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("uploads and removes the organization logo through the provided handlers", async () => {
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
      const [logoUrl, setLogoUrl] = useState<string | null>(null);
      const [busy, setBusy] = useState(false);

      return (
        <OrganizationGeneralSettingsPageView
          isLoading={false}
          isSaving={false}
          loadErrorMessage={null}
          logoBusy={busy}
          logoErrorMessage={null}
          logoUrl={logoUrl}
          name="Mistle"
          onDeleteLogo={async () => {
            removeCount += 1;
            setLogoUrl(null);
          }}
          onSaveChanges={async () => {}}
          onUploadLogo={async (file) => {
            uploadedFiles.push(file);
            setBusy(true);
            const deferred = createDeferredPromise<void>();
            finishUpload = () => {
              setLogoUrl("https://example.com/updated-logo.webp");
              setBusy(false);
              deferred.resolve(undefined);
            };
            await deferred.promise;
          }}
        />
      );
    }

    render(<Harness />);

    const uploadInput = screen.getByLabelText("Upload organization logo", {
      selector: "input",
    });
    const uploadFile = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });

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
      expect(screen.getByRole("button", { name: "Edit organization logo" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove organization logo" }));

    await waitFor(() => {
      expect(removeCount).toBe(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Upload organization logo" })).toBeTruthy();
    });
  });
});
