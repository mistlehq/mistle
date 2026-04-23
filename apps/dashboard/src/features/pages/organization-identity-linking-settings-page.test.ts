import { describe, expect, it } from "vitest";

import { buildProviderRow } from "./organization-identity-linking-settings-page.js";

describe("buildProviderRow", () => {
  it("returns an autosave row model when the selected connection differs from the saved config", () => {
    const providerRow = buildProviderRow({
      configuringProviderFamily: null,
      statusUpdatingProviderFamily: null,
      provider: {
        providerFamily: "github",
        displayName: "GitHub",
        logoKey: "github",
        eligibleTargetKeys: ["github-cloud"],
        eligibleConnectionMethodIds: ["github-app-installation"],
        eligibleConnections: [
          {
            id: "icn_github_saved",
            targetKey: "github-cloud",
            displayName: "GitHub Saved",
            status: "active",
            connectionMethodId: "github-app-installation",
            connectionMethodLabel: "GitHub App installation",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "icn_github_new",
            targetKey: "github-cloud",
            displayName: "GitHub New",
            status: "active",
            connectionMethodId: "github-app-installation",
            connectionMethodLabel: "GitHub App installation",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        configurationStatus: "disabled",
        selectedConnection: {
          id: "icn_github_saved",
          targetKey: "github-cloud",
          displayName: "GitHub Saved",
          status: "active",
          connectionMethodId: "github-app-installation",
          connectionMethodLabel: "GitHub App installation",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        configuredAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      providerLinksQuery: {
        data: [
          {
            userId: "usr_github_saved",
            name: "GitHub Saved User",
            email: "saved@example.com",
            linked: true,
            principalSummary: {
              providerSubjectId: "github_saved_123",
              login: "saved-github",
              displayName: "Saved GitHub",
              email: "saved@example.com",
            },
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        isPending: false,
        isError: false,
        error: null,
      },
      selectedConnectionIdByProviderFamily: {
        github: "icn_github_new",
      },
    });

    expect(providerRow.selectedConnectionId).toBe("icn_github_new");
    expect(providerRow.enabled).toBe(false);
    expect(providerRow.connectionOptions).toEqual([
      {
        id: "icn_github_new",
        label: "GitHub New · GitHub App installation",
      },
      {
        id: "icn_github_saved",
        label: "GitHub Saved · GitHub App installation",
      },
    ]);
    expect(providerRow.linkedUsersCount).toBe(1);
    expect(providerRow.memberLinks).toEqual([
      {
        userId: "usr_github_saved",
        name: "GitHub Saved User",
        email: "saved@example.com",
        statusLabel: "Linked",
        principalSummary: "Saved GitHub",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("keeps the currently displayed fallback connection when an unsaved provider has no persisted selection", () => {
    const providerRow = buildProviderRow({
      configuringProviderFamily: null,
      statusUpdatingProviderFamily: null,
      provider: {
        providerFamily: "slack",
        displayName: "Slack",
        logoKey: "slack",
        eligibleTargetKeys: ["slack-default"],
        eligibleConnectionMethodIds: ["slack-bot-token"],
        eligibleConnections: [
          {
            id: "icn_slack_first",
            targetKey: "slack-default",
            displayName: "Slack First",
            status: "active",
            connectionMethodId: "slack-bot-token",
            connectionMethodLabel: "Slack bot token",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "icn_slack_second",
            targetKey: "slack-default",
            displayName: "Slack Second",
            status: "active",
            connectionMethodId: "slack-bot-token",
            connectionMethodLabel: "Slack bot token",
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        ],
        configurationStatus: "disabled",
        selectedConnection: null,
        configuredAt: null,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      providerLinksQuery: null,
      selectedConnectionIdByProviderFamily: {
        slack: "icn_slack_first",
      },
    });

    expect(providerRow.selectedConnectionId).toBe("icn_slack_first");
    expect(providerRow.connectionOptions).toEqual([
      {
        id: "icn_slack_first",
        label: "Slack First · Slack bot token",
      },
      {
        id: "icn_slack_second",
        label: "Slack Second · Slack bot token",
      },
    ]);
  });
});
