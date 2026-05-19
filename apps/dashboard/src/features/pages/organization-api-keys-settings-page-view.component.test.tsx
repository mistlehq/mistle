// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { ApiKey } from "../settings/api-keys/api-keys-service.js";
import { OrganizationApiKeyCreatePageView } from "./organization-api-key-create-page-view.js";
import { OrganizationApiKeysSettingsPageView } from "./organization-api-keys-settings-page-view.js";

describe("OrganizationApiKeysSettingsPageView", () => {
  it("renders existing API keys with masked keys and compact raw permission badges", () => {
    renderPage({
      apiKeys: [
        buildApiKey({
          id: "apk_prod",
          name: "Production deploy key",
          secretPrefix: "mst_live_1234",
          permissions: [
            "sandboxProfile:read",
            "sandboxSession:create",
            "sandboxSession:connect",
            "triggerWebhook:read",
            "unknown:permission",
          ],
          lastUsedAt: "2026-05-18T10:00:00.000Z",
        }),
      ],
    });

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Key" })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "Prefix" })).toBeNull();
    expect(screen.getByText("Production deploy key")).toBeTruthy();
    expect(within(table).getByText("mst_live_1234...")).toBeTruthy();
    expect(within(table).getByText("sandboxProfile:read")).toBeTruthy();
    expect(within(table).getByText("sandboxSession:create")).toBeTruthy();
    expect(within(table).getByText("sandboxSession:connect")).toBeTruthy();
    expect(within(table).getByText("+ 2 more")).toBeTruthy();
    expect(within(table).queryByText("triggerWebhook:read")).toBeNull();
    expect(within(table).queryByText("unknown:permission")).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke Production deploy key" })).toBeTruthy();
  });

  it("links API key creation to a dedicated page", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Create API key" }).getAttribute("href")).toBe(
      "/settings/organization/api-keys/new",
    );
  });

  it("confirms before revoking an API key", () => {
    const apiKey = buildApiKey({
      id: "apk_prod",
      name: "Production deploy key",
    });
    const revokedApiKeys: ApiKey[] = [];

    renderPage({
      apiKeys: [apiKey],
      onRevokeApiKey: (revokedApiKey) => {
        revokedApiKeys.push(revokedApiKey);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Revoke Production deploy key" }));

    expect(screen.getByRole("alertdialog", { name: "Revoke API key?" })).toBeTruthy();
    expect(
      screen.getByText("Requests using Production deploy key will stop working immediately."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep key" }));

    expect(revokedApiKeys).toEqual([]);
    expect(screen.queryByRole("alertdialog", { name: "Revoke API key?" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revoke Production deploy key" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));

    expect(revokedApiKeys).toEqual([apiKey]);
  });

  it("shows the one-time created token on the list page", () => {
    const dismissedNotices: string[] = [];

    renderPage({
      createdApiKeyNotice: {
        name: "New key",
        token: "mst_test_secret_token",
      },
      onDismissCreatedApiKeyNotice: () => {
        dismissedNotices.push("dismissed");
      },
    });

    expect(screen.getByText("API key created")).toBeTruthy();
    expect(
      screen.getByText("Copy the token for New key now. It will not be shown again."),
    ).toBeTruthy();
    expect(screen.getByText("mst_test_secret_token")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy API key token" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(dismissedNotices).toEqual(["dismissed"]);
  });

  it("renders an empty state before any API keys exist", () => {
    renderPage();

    const emptyState = screen.getByText("No API keys").closest("[data-slot='empty']");
    expect(emptyState).not.toBeNull();

    if (emptyState === null) {
      throw new Error("Expected API keys empty state.");
    }

    expect(
      screen.getByText("Create an API key to access Mistle from scripts or services."),
    ).toBeTruthy();
  });
});

describe("OrganizationApiKeyCreatePageView", () => {
  it("submits the trimmed key name with selected permissions", () => {
    const submissions: { name: string; permissions: readonly string[] }[] = [];
    renderCreatePage({
      onCreateApiKey: (input) => {
        submissions.push(input);
      },
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "  CI runner  " },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Create sessions/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    expect(submissions).toEqual([
      {
        name: "CI runner",
        permissions: ["sandboxProfile:read", "sandboxSession:read", "sandboxSession:connect"],
      },
    ]);
  });
});

function renderPage(
  overrides: Partial<ComponentProps<typeof OrganizationApiKeysSettingsPageView>> = {},
): void {
  render(
    <MemoryRouter>
      <OrganizationApiKeysSettingsPageView
        apiKeys={[]}
        createdApiKeyNotice={null}
        isLoading={false}
        listErrorMessage={null}
        onDismissCreatedApiKeyNotice={() => undefined}
        onRevokeApiKey={() => undefined}
        revokeErrorMessage={null}
        revokingApiKeyId={null}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

function renderCreatePage(
  overrides: Partial<ComponentProps<typeof OrganizationApiKeyCreatePageView>> = {},
): void {
  render(
    <OrganizationApiKeyCreatePageView
      createErrorMessage={null}
      isCreating={false}
      onCreateApiKey={() => undefined}
      {...overrides}
    />,
  );
}

function buildApiKey(overrides: Partial<ApiKey> & Pick<ApiKey, "id" | "name">): ApiKey {
  const { id, name, ...restOverrides } = overrides;

  return {
    id,
    name,
    secretPrefix: "mst_test",
    permissions: ["sandboxProfile:read"],
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-05-17T09:00:00.000Z",
    updatedAt: "2026-05-17T09:00:00.000Z",
    ...restOverrides,
  };
}
