import { describe, expect, it } from "vitest";

import type {
  OrganizationIdentityLinkProvider,
  OrganizationIdentityLinkProviderConfig,
} from "../settings/identity-linking/organization-identity-linking-service.js";
import {
  buildProviderConfigRows,
  buildProviderRow,
} from "./organization-identity-linking-settings-page.js";

describe("buildProviderRow", () => {
  it("does not add a draft row when every eligible connection is already configured", () => {
    const rows = buildProviderConfigRows([
      createProvider({
        configs: [
          createConfig({
            organizationProviderConfigId: "ilp_github_saved",
            integrationConnectionId: "icn_github_saved",
          }),
        ],
      }),
    ]);

    expect(rows.map((row) => row.rowKey)).toEqual(["ilp_github_saved"]);
  });

  it("adds a draft row when another eligible connection remains unused", () => {
    const rows = buildProviderConfigRows([
      createProvider({
        eligibleConnections: [
          createConnection({
            id: "icn_github_saved",
            displayName: "GitHub Saved",
          }),
          createConnection({
            id: "icn_github_next",
            displayName: "GitHub Next",
          }),
        ],
        configs: [
          createConfig({
            organizationProviderConfigId: "ilp_github_saved",
            integrationConnectionId: "icn_github_saved",
          }),
        ],
      }),
    ]);

    expect(rows.map((row) => row.rowKey)).toEqual(["ilp_github_saved", "draft:github"]);
  });

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

function createProvider(
  overrides: Partial<OrganizationIdentityLinkProvider> = {},
): OrganizationIdentityLinkProvider {
  const selectedConnection = createConnection({
    id: "icn_github_saved",
    displayName: "GitHub Saved",
  });

  return {
    providerFamily: "github",
    organizationProviderConfigId: "ilp_github_saved",
    integrationConnectionId: "icn_github_saved",
    displayName: "GitHub",
    logoKey: "github",
    eligibleTargetKeys: ["github-cloud"],
    eligibleConnectionMethodIds: ["github-app-installation"],
    eligibleConnections: [selectedConnection],
    configurationStatus: "active",
    selectedConnection,
    configuredAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    configs: [
      createConfig({
        organizationProviderConfigId: "ilp_github_saved",
        integrationConnectionId: "icn_github_saved",
      }),
    ],
    ...overrides,
  };
}

function createConfig(
  overrides: Partial<OrganizationIdentityLinkProviderConfig> = {},
): OrganizationIdentityLinkProviderConfig {
  const selectedConnection = createConnection({
    id: overrides.integrationConnectionId ?? "icn_github_saved",
    displayName: "GitHub Saved",
  });

  return {
    organizationProviderConfigId: "ilp_github_saved",
    integrationConnectionId: "icn_github_saved",
    configurationStatus: "active",
    selectedConnection,
    configuredAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createConnection(input: {
  id: string;
  displayName: string;
}): OrganizationIdentityLinkProvider["eligibleConnections"][number] {
  return {
    id: input.id,
    targetKey: "github-cloud",
    displayName: input.displayName,
    status: "active",
    connectionMethodId: "github-app-installation",
    connectionMethodLabel: "GitHub App installation",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
