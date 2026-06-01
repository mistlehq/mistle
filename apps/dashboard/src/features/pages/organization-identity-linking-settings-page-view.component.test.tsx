// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  OrganizationIdentityLinkingSettingsPageView,
  type OrganizationIdentityLinkingProviderRow,
} from "./organization-identity-linking-settings-page-view.js";

describe("OrganizationIdentityLinkingSettingsPageView", () => {
  it("renders connection rows and opens the link status sheet", () => {
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
            memberLinkStatusCounts: { linked: 1, total: 2 },
            memberLinks: [
              {
                userId: "usr_owner",
                name: "Owner User",
                email: "owner@example.com",
                linked: true,
                statusLabel: "Linked",
              },
              {
                userId: "usr_member",
                name: "Member User",
                email: "member@example.com",
                linked: false,
                statusLabel: "Not linked",
              },
            ],
          }),
          createProviderRow({
            rowKey: "linear:icn_linear",
            canOpenMemberLinkStatus: false,
            displayName: "Linear",
            logoKey: "linear",
            connectionLabel: "Linear Workspace",
            enabled: false,
            memberLinkStatusCounts: null,
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
    expect(screen.getByText("1 linked out of 2")).toBeTruthy();
    expect(screen.getByText("Linear Workspace")).toBeTruthy();
    expect(screen.getByText("-")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "View GitHub link status for Engineering GitHub",
      }),
    );

    expect(screen.getByText("Link Status for Engineering GitHub")).toBeTruthy();
    expect(screen.getByText("Owner User")).toBeTruthy();
    expect(screen.getByText("Member User")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Not linked 1" }));

    expect(screen.queryByText("Owner User")).toBeNull();
    expect(screen.getByText("Member User")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Linked 1" }));

    expect(screen.getByText("Owner User")).toBeTruthy();
    expect(screen.queryByText("Member User")).toBeNull();
  });

  it("preserves the selected link status filter when row data refreshes", () => {
    const { rerender } = render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            memberLinkStatusCounts: { linked: 1, total: 2 },
            memberLinks: createMixedMemberLinks(),
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View GitHub link status for Engineering GitHub",
      }),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Not linked 1" }));

    expect(screen.getByText("Member User")).toBeTruthy();
    expect(screen.queryByText("Owner User")).toBeNull();

    rerender(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            memberLinkStatusCounts: { linked: 1, total: 2 },
            memberLinks: createMixedMemberLinks(),
          }),
        ]}
      />,
    );

    expect(screen.getByText("Member User")).toBeTruthy();
    expect(screen.queryByText("Owner User")).toBeNull();
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
            canOpenMemberLinkStatus: false,
            displayName: "Slack",
            logoKey: "slack",
            connectionLabel: "Slack Workspace",
            enabled: false,
            memberLinkStatusCounts: null,
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
            canOpenMemberLinkStatus: false,
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
            canOpenMemberLinkStatus: true,
            displayName: "Slack",
            logoKey: "slack",
            connectionLabel: "Mistle Engineering · Slack app",
          }),
          createProviderRow({
            rowKey: "slack:icn_slack_support",
            canOpenMemberLinkStatus: true,
            displayName: "Slack",
            logoKey: "slack",
            connectionLabel: "Mistle Support · Slack app",
            memberLinkStatusCounts: { linked: 0, total: 0 },
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Slack")).toHaveLength(2);
    expect(screen.getByText("Mistle Engineering · Slack app")).toBeTruthy();
    expect(screen.getByText("Mistle Support · Slack app")).toBeTruthy();
  });

  it("renders provider-scoped link status errors in the sheet", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            memberLinksErrorMessage: "Could not load link status.",
            memberLinks: [],
            memberLinkStatusCounts: { linked: 0, total: 0 },
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View GitHub link status for Engineering GitHub",
      }),
    );

    expect(screen.getByText("Could not load link status.")).toBeTruthy();
  });

  it("keeps the link status sheet body empty while status counts are unknown", () => {
    render(
      <OrganizationIdentityLinkingSettingsPageView
        gitCommitSigningImpactConfirmation={null}
        loadErrorMessage={null}
        onCancelGitCommitSigningImpactConfirmation={() => {}}
        onEnabledChange={async () => {}}
        onConfirmGitCommitSigningImpactConfirmation={async () => {}}
        providers={[
          createProviderRow({
            memberLinkStatusCounts: null,
            memberLinks: [],
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View GitHub link status for Engineering GitHub",
      }),
    );

    expect(screen.getByText("Link Status for Engineering GitHub")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("No members to show.")).toBeNull();
  });

  it("shows an empty state when there are no members to show", () => {
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
            memberLinkStatusCounts: { linked: 0, total: 0 },
            memberLinks: [],
          }),
        ]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "View Slack link status for Slack Workspace",
      }),
    );

    expect(screen.getByText("No members to show.")).toBeTruthy();
  });
});

function createProviderRow(
  overrides: Partial<OrganizationIdentityLinkingProviderRow> = {},
): OrganizationIdentityLinkingProviderRow {
  return {
    rowKey: "github:icn_github_engineering",
    canOpenMemberLinkStatus: true,
    displayName: "GitHub",
    logoKey: "github",
    connectionLabel: "Engineering GitHub",
    enablePending: false,
    enabled: true,
    unavailableMessage: null,
    memberLinkStatusCounts: { linked: 1, total: 1 },
    memberLinksErrorMessage: null,
    memberLinks: [],
    ...overrides,
  };
}

function createMixedMemberLinks(): OrganizationIdentityLinkingProviderRow["memberLinks"] {
  return [
    {
      userId: "usr_owner",
      name: "Owner User",
      email: "owner@example.com",
      linked: true,
      statusLabel: "Linked",
    },
    {
      userId: "usr_member",
      name: "Member User",
      email: "member@example.com",
      linked: false,
      statusLabel: "Not linked",
    },
  ];
}
