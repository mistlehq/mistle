import { describe, expect, it } from "vitest";

import { buildProviderRow } from "./organization-identity-linking-settings-page.js";

describe("buildProviderRow", () => {
  it("returns a config-scoped row model when the selected connection differs from the saved config", () => {
    const providerRow = buildProviderRow({
      configuringRowKey: null,
      statusUpdatingRowKey: null,
      row: {
        rowKey: "ilp_github_saved",
        provider: {
          providerFamily: "github",
          organizationProviderConfigId: "ilp_github_saved",
          integrationConnectionId: "icn_github_saved",
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
          configs: [],
        },
        config: {
          organizationProviderConfigId: "ilp_github_saved",
          integrationConnectionId: "icn_github_saved",
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
      selectedConnectionIdByRowKey: {
        ilp_github_saved: "icn_github_new",
      },
    });

    expect(providerRow.rowKey).toBe("ilp_github_saved");
    expect(providerRow.organizationProviderConfigId).toBe("ilp_github_saved");
    expect(providerRow.selectedConnectionId).toBe("icn_github_new");
    expect(providerRow.enabled).toBe(false);
    expect(providerRow.linkedUsersCount).toBe(1);
  });

  it("keeps the currently displayed fallback connection for a draft config row", () => {
    const providerRow = buildProviderRow({
      configuringRowKey: null,
      statusUpdatingRowKey: null,
      row: {
        rowKey: "draft:slack",
        provider: {
          providerFamily: "slack",
          organizationProviderConfigId: null,
          integrationConnectionId: null,
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
          ],
          configurationStatus: "unconfigured",
          selectedConnection: null,
          configuredAt: null,
          updatedAt: null,
          configs: [],
        },
        config: null,
      },
      providerLinksQuery: null,
      selectedConnectionIdByRowKey: {
        "draft:slack": "icn_slack_first",
      },
    });

    expect(providerRow.organizationProviderConfigId).toBeNull();
    expect(providerRow.selectedConnectionId).toBe("icn_slack_first");
    expect(providerRow.linkedUsersCount).toBeNull();
  });
});
