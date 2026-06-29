// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { ApiKey } from "../settings/api-keys/api-keys-service.js";
import { OrganizationApiKeyCreatePageView } from "./organization-api-key-create-page-view.js";
import {
  OrganizationApiKeysCreateActionLink,
  OrganizationApiKeysSettingsPageView,
} from "./organization-api-keys-settings-page-view.js";

describe("OrganizationApiKeysSettingsPageView", () => {
  it("renders existing API keys with masked keys and grouped permission details", () => {
    renderPage({
      apiKeys: [
        buildApiKey({
          id: "apk_prod",
          name: "Production deploy key",
          secretPrefix: "ED4p8qJIc8ptYvhuD8yyOQ",
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
    expect(within(table).getByRole("columnheader", { name: "Key prefix" })).toBeTruthy();
    expect(within(table).queryByRole("columnheader", { name: "Prefix" })).toBeNull();
    expect(screen.getByText("Production deploy key")).toBeTruthy();
    const keyPrefix = within(table).getByText("mstl_apk_ED4p8qJIc8ptYvhuD8yyOQ");
    expect(keyPrefix).toBeTruthy();
    expect(keyPrefix.getAttribute("title")).toBe("mstl_apk_ED4p8qJIc8ptYvhuD8yyOQ");
    expect(
      within(table).getByRole("button", {
        name: "View allowed Mistle resources: 3 resources, 1 other permission",
      }),
    ).toBeTruthy();
    expect(within(table).queryByText("sandboxProfile:read")).toBeNull();
    expect(within(table).queryByText("triggerWebhook:read")).toBeNull();
    expect(within(table).queryByText("unknown:permission")).toBeNull();
    expect(
      screen.getByRole("button", { name: "API key actions for Production deploy key" }),
    ).toBeTruthy();

    fireEvent.click(
      within(table).getByRole("button", {
        name: "View allowed Mistle resources: 3 resources, 1 other permission",
      }),
    );

    const dialog = screen.getByRole("dialog", { name: "Allowed Mistle resources" });
    expect(
      within(dialog).getByText(
        "Production deploy key can access these Mistle resources. Access is limited by this API key's permissions.",
      ),
    ).toBeTruthy();
    expect(within(dialog).getByText("Sandbox profiles")).toBeTruthy();
    expect(within(dialog).getByText("Read sandbox profiles")).toBeTruthy();
    expect(within(dialog).getByText("Sessions")).toBeTruthy();
    expect(within(dialog).getByText("Create sessions")).toBeTruthy();
    expect(within(dialog).getByText("Connect to sessions")).toBeTruthy();
    expect(within(dialog).getByText("Triggers")).toBeTruthy();
    expect(within(dialog).getByText("Read triggers")).toBeTruthy();
    expect(within(dialog).getByText("Other permissions")).toBeTruthy();
    expect(within(dialog).getByText("unknown:permission")).toBeTruthy();
  });

  it("links API key creation to a dedicated page", () => {
    render(
      <MemoryRouter>
        <OrganizationApiKeysCreateActionLink />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Create API key" }).getAttribute("href")).toBe(
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

    fireEvent.click(
      screen.getByRole("button", { name: "API key actions for Production deploy key" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke key" }));

    expect(screen.getByRole("alertdialog", { name: "Revoke API key?" })).toBeTruthy();
    expect(
      screen.getByText("Requests using Production deploy key will stop working immediately."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep key" }));

    expect(revokedApiKeys).toEqual([]);
    expect(screen.queryByRole("alertdialog", { name: "Revoke API key?" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "API key actions for Production deploy key" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke key" }));
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

  it("does not render local loading copy or empty state while API keys load", () => {
    renderPage({
      isLoading: true,
    });

    expect(screen.queryByText("Loading API keys...")).toBeNull();
    expect(screen.queryByText("No API keys")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
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

  it("submits generic trigger permissions for new API keys", () => {
    const submissions: { name: string; permissions: readonly string[] }[] = [];
    renderCreatePage({
      onCreateApiKey: (input) => {
        submissions.push(input);
      },
    });

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Trigger automation" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Read triggers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create API key" }));

    expect(submissions).toEqual([
      {
        name: "Trigger automation",
        permissions: [
          "sandboxProfile:read",
          "sandboxSession:create",
          "sandboxSession:read",
          "sandboxSession:connect",
          "trigger:read",
        ],
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
