// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrganizationIdentityLinkingSettingsPageView } from "./organization-identity-linking-settings-page-view.js";

describe("OrganizationIdentityLinkingSettingsPageView", () => {
  it("renders provider rows and opens the linked users dialog", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        loadErrorMessage={null}
        onEnabledChange={async () => {}}
        onProviderConnectionChange={async () => {}}
        providers={[
          {
            rowKey: "ilp_github",
            providerFamily: "github",
            organizationProviderConfigId: "ilp_github",
            displayName: "GitHub",
            logoKey: "github",
            connectionOptions: [
              {
                id: "icn_github",
                label: "Engineering GitHub · GitHub App installation",
              },
            ],
            selectedConnectionId: "icn_github",
            connectionPending: false,
            enablePending: false,
            enabled: true,
            linkedUsersCount: 1,
            memberLinksErrorMessage: null,
            memberLinks: [
              {
                userId: "usr_owner",
                name: "Owner User",
                email: "owner@example.com",
                statusLabel: "Linked",
                principalSummary: "owner-github",
                updatedAt: "2026-04-20T00:00:00.000Z",
              },
            ],
          },
          {
            rowKey: "draft:linear",
            providerFamily: "linear",
            organizationProviderConfigId: null,
            displayName: "Linear",
            logoKey: "linear",
            connectionOptions: [],
            selectedConnectionId: null,
            connectionPending: false,
            enablePending: false,
            enabled: false,
            linkedUsersCount: 0,
            memberLinksErrorMessage: null,
            memberLinks: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "GitHub connection" })).toBeTruthy();
    expect(screen.getByText("No eligible active connections")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Enable GitHub identity linking" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View GitHub linked users" }));

    expect(screen.getByText("GitHub linked users")).toBeTruthy();
    expect(screen.getByText("Owner User")).toBeTruthy();
    expect(screen.getByText("owner-github")).toBeTruthy();
  });

  it("runs the enabled-change handler from the row switch", async () => {
    const enabledStates: boolean[] = [];

    render(
      <OrganizationIdentityLinkingSettingsPageView
        loadErrorMessage={null}
        onEnabledChange={async ({ enabled }) => {
          enabledStates.push(enabled);
        }}
        onProviderConnectionChange={async () => {}}
        providers={[
          {
            rowKey: "draft:slack",
            providerFamily: "slack",
            organizationProviderConfigId: null,
            displayName: "Slack",
            logoKey: "slack",
            connectionOptions: [
              {
                id: "icn_slack",
                label: "Slack Workspace",
              },
            ],
            selectedConnectionId: "icn_slack",
            connectionPending: false,
            enablePending: false,
            enabled: false,
            linkedUsersCount: 0,
            memberLinksErrorMessage: null,
            memberLinks: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable Slack identity linking" }));

    await waitFor(() => {
      expect(enabledStates).toEqual([true]);
    });
  });

  it("renders provider-scoped linked-user errors in the dialog", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        loadErrorMessage={null}
        onEnabledChange={async () => {}}
        onProviderConnectionChange={async () => {}}
        providers={[
          {
            rowKey: "ilp_github",
            providerFamily: "github",
            organizationProviderConfigId: "ilp_github",
            displayName: "GitHub",
            logoKey: "github",
            connectionOptions: [],
            selectedConnectionId: null,
            connectionPending: false,
            enablePending: false,
            enabled: false,
            linkedUsersCount: null,
            memberLinksErrorMessage: "Could not load linked-member visibility.",
            memberLinks: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View GitHub linked users" }));

    expect(screen.getByText("Could not load linked-member visibility.")).toBeTruthy();
  });

  it("keeps the linked-users dialog body empty while linked users are unknown", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        loadErrorMessage={null}
        onEnabledChange={async () => {}}
        onProviderConnectionChange={async () => {}}
        providers={[
          {
            rowKey: "ilp_github",
            providerFamily: "github",
            organizationProviderConfigId: "ilp_github",
            displayName: "GitHub",
            logoKey: "github",
            connectionOptions: [],
            selectedConnectionId: null,
            connectionPending: false,
            enablePending: false,
            enabled: false,
            linkedUsersCount: null,
            memberLinksErrorMessage: null,
            memberLinks: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View GitHub linked users" }));

    expect(screen.getByText("GitHub linked users")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(
      screen.queryByText("No organization members are linked for this integration yet."),
    ).toBeNull();
  });
});
