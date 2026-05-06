// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OrganizationSandboxStorageFormState } from "../settings/organization/sandbox-storage-model.js";
import { OrganizationSandboxStorageSettingsPageView } from "./organization-sandbox-storage-settings-page-view.js";

const ManagedState: OrganizationSandboxStorageFormState = {
  persistentSandboxesEnabled: false,
  storageConfigSource: "managed",
  region: "",
  namePrefix: "",
  apiKey: "",
  apiKeyConfigured: false,
  bucket: "",
  endpoint: "",
  accessKeyId: "",
  secretAccessKey: "",
  secretAccessKeyConfigured: false,
};

describe("OrganizationSandboxStorageSettingsPageView", () => {
  it("autosaves persistent sandbox changes from the switch without a save button", async () => {
    const enabledStates: boolean[] = [];

    render(
      <OrganizationSandboxStorageSettingsPageView
        isSaving={false}
        loadErrorMessage={null}
        onPersistentSandboxesEnabledChange={async (enabled) => {
          enabledStates.push(enabled);
        }}
        onStateChange={() => {}}
        saveErrorMessage={null}
        state={ManagedState}
        visibleErrors={{}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Experimental" })).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "Allow persistent sandboxes" }));

    await waitFor(() => {
      expect(enabledStates).toEqual([true]);
    });
  });

  it("disables the persistent sandbox switch while saving without adding status text", () => {
    render(
      <OrganizationSandboxStorageSettingsPageView
        isSaving={true}
        loadErrorMessage={null}
        onPersistentSandboxesEnabledChange={async () => {}}
        onStateChange={() => {}}
        saveErrorMessage={null}
        state={ManagedState}
        visibleErrors={{}}
      />,
    );

    expect(
      screen
        .getByRole("switch", { name: "Allow persistent sandboxes" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
    expect(screen.queryByText("Saving...")).toBeNull();
  });
});
