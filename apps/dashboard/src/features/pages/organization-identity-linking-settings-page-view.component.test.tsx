// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  OrganizationIdentityLinkingSettingsPageView,
  type OrganizationIdentityLinkingProviderRow,
} from "./organization-identity-linking-settings-page-view.js";

describe("OrganizationIdentityLinkingSettingsPageView", () => {
  it("renders connection rows and opens the linked users dialog", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            connectionLabel: "Engineering GitHub",
            linkedUsersCount: 1,
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
          }),
          createProviderRow({
            rowKey: "linear:icn_linear",
            canOpenLinkedUsers: false,
            displayName: "Linear",
            logoKey: "linear",
            connectionLabel: "Linear Workspace",
            enabled: false,
            linkedUsersCount: null,
          }),
        ]}
      />,
    );

    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Engineering GitHub")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "GitHub connection" })).toBeNull();
    expect(
      screen.getByRole("switch", {
        name: "Enable GitHub identity linking for Engineering GitHub",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Linear Workspace")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "View GitHub linked users for Engineering GitHub",
      }),
    );

    expect(screen.getByText("GitHub linked users for Engineering GitHub")).toBeTruthy();
    expect(screen.getByText("Owner User")).toBeTruthy();
    expect(screen.getByText("owner-github")).toBeTruthy();
  });

  it("runs the enabled-change handler from the row switch", async () => {
    const enabledStates: boolean[] = [];

    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async ({ enabled }) => {
          enabledStates.push(enabled);
        }}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            rowKey: "slack:icn_slack",
            canOpenLinkedUsers: false,
            displayName: "Slack",
            logoKey: "slack",
            connectionLabel: "Slack Workspace",
            enabled: false,
            linkedUsersCount: null,
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Enable Slack identity linking for Slack Workspace",
      }),
    );

    await waitFor(() => {
      expect(enabledStates).toEqual([true]);
    });
  });

  it("disables enabling unavailable unconfigured rows", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            canOpenLinkedUsers: false,
            enabled: false,
            unavailableMessage:
              "This connection is no longer active. Reconnect it before enabling identity linking.",
          }),
        ]}
      />,
    );

    expect(
      screen
        .getByRole("switch", {
          name: "Enable GitHub identity linking for Engineering GitHub",
        })
        .getAttribute("data-disabled"),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "This connection is no longer active. Reconnect it before enabling identity linking.",
      ),
    ).toBeTruthy();
  });

  it("shows commit-signing impact in a confirmation dialog", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={{
          action: "enable",
          connectionLabel: "Engineering GitHub",
          providerDisplayName: "GitHub",
          updatedProfileCount: 4,
          invariantViolationCount: 0,
          pending: false,
        }}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[createProviderRow({ enabled: false })]}
      />,
    );

    expect(screen.getByText("Enable GitHub identity linking?")).toBeTruthy();
    expect(
      screen.getByText(
        "Commit signing will be enabled for 4 sandbox profiles using Engineering GitHub.",
      ),
    ).toBeTruthy();
  });

  it("confirms commit-signing impact before applying the identity-linking change", async () => {
    const confirmed: string[] = [];

    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={{
          action: "disable",
          connectionLabel: "Engineering GitHub",
          providerDisplayName: "GitHub",
          updatedProfileCount: 1,
          invariantViolationCount: 1,
          pending: false,
        }}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {
          confirmed.push("confirmed");
        }}
        providers={[createProviderRow({ enabled: true })]}
      />,
    );

    expect(screen.getByText("Disable GitHub identity linking?")).toBeTruthy();
    expect(
      screen.getByText(
        "Some sandbox profiles have inconsistent commit signing state and will not be updated.",
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disable identity linking" }));

    await waitFor(() => {
      expect(confirmed).toEqual(["confirmed"]);
    });
  });

  it("renders multiple same-family connection rows with distinct labels", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            rowKey: "slack:icn_slack_engineering",
            canOpenLinkedUsers: true,
            displayName: "Slack",
            logoKey: "slack",
            connectionLabel: "Mistle Engineering · Slack app",
          }),
          createProviderRow({
            rowKey: "slack:icn_slack_support",
            canOpenLinkedUsers: true,
            displayName: "Slack",
            logoKey: "slack",
            connectionLabel: "Mistle Support · Slack app",
            linkedUsersCount: 0,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Slack")).toHaveLength(2);
    expect(screen.getByText("Mistle Engineering · Slack app")).toBeTruthy();
    expect(screen.getByText("Mistle Support · Slack app")).toBeTruthy();
  });

  it("renders provider-scoped linked-user errors in the dialog", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            memberLinksErrorMessage: "Could not load linked-member visibility.",
            memberLinks: [],
            linkedUsersCount: 0,
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View GitHub linked users for Engineering GitHub",
      }),
    );

    expect(screen.getByText("Could not load linked-member visibility.")).toBeTruthy();
  });

  it("keeps the linked-users dialog body empty while linked users are unknown", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            linkedUsersCount: null,
            memberLinks: [],
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View GitHub linked users for Engineering GitHub",
      }),
    );

    expect(screen.getByText("GitHub linked users for Engineering GitHub")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("No linked users.")).toBeNull();
  });

  it("shows an empty state when there are no linked users", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            displayName: "Slack",
            logoKey: "slack",
            connectionLabel: "Slack Workspace",
            linkedUsersCount: 0,
            memberLinks: [],
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View Slack linked users for Slack Workspace",
      }),
    );

    expect(screen.getByText("No linked users.")).toBeTruthy();
  });
});

function createProviderRow(
  overrides: Partial<OrganizationIdentityLinkingProviderRow> = {},
): OrganizationIdentityLinkingProviderRow {
  return {
    rowKey: "github:icn_github_engineering",
    canOpenLinkedUsers: true,
    displayName: "GitHub",
    logoKey: "github",
    connectionLabel: "Engineering GitHub",
    enablePending: false,
    enabled: true,
    unavailableMessage: null,
    linkedUsersCount: 1,
    memberLinksErrorMessage: null,
    memberLinks: [],
    ...overrides,
  };
}
