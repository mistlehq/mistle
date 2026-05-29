import { describe, expect, it } from "vitest";

import type {
  OrganizationIdentityLinkProvider,
  OrganizationIdentityLinkProviderConfig,
} from "../settings/identity-linking/organization-identity-linking-service.js";
import {
  buildIdentityLinkingConnectionRows,
  buildProviderRow,
} from "./organization-identity-linking-settings-page.js";

describe("buildIdentityLinkingConnectionRows", () => {
  it("returns one row for each eligible connection", () => {
    const rows = buildIdentityLinkingConnectionRows([
      createProvider({
        eligibleConnections: [
          createConnection({
            id: "icn_github_engineering",
            displayName: "GitHub Engineering",
          }),
          createConnection({
            id: "icn_github_platform",
            displayName: "GitHub Platform",
          }),
        ],
        configs: [
          createConfig({
            organizationProviderConfigId: "ilp_github_engineering",
            integrationConnectionId: "icn_github_engineering",
            selectedConnection: createConnection({
              id: "icn_github_engineering",
              displayName: "GitHub Engineering",
            }),
          }),
        ],
      }),
    ]);

    expect(rows.map((row) => row.rowKey)).toEqual([
      "github:icn_github_engineering",
      "github:icn_github_platform",
    ]);
    expect(rows.map((row) => row.config?.organizationProviderConfigId ?? null)).toEqual([
      "ilp_github_engineering",
      null,
    ]);
  });

  it("keeps configured connections visible when they are no longer eligible", () => {
    const rows = buildIdentityLinkingConnectionRows([
      createProvider({
        eligibleConnections: [
          createConnection({
            id: "icn_github_platform",
            displayName: "GitHub Platform",
          }),
        ],
        configs: [
          createConfig({
            organizationProviderConfigId: "ilp_github_engineering",
            integrationConnectionId: "icn_github_engineering",
            selectedConnection: createConnection({
              id: "icn_github_engineering",
              displayName: "GitHub Engineering",
            }),
          }),
        ],
      }),
    ]);

    expect(rows.map((row) => row.rowKey)).toEqual([
      "github:icn_github_platform",
      "github:icn_github_engineering",
    ]);
    expect(rows.map((row) => row.available)).toEqual([true, false]);
  });

  it("keeps a provider row visible when no eligible connections exist", () => {
    const rows = buildIdentityLinkingConnectionRows([
      createProvider({
        eligibleConnections: [],
        configs: [],
      }),
    ]);

    expect(rows.map((row) => row.rowKey)).toEqual(["github:no-eligible-connection"]);
    expect(rows.map((row) => row.config)).toEqual([null]);
    expect(rows.map((row) => row.available)).toEqual([false]);
  });

  it("fails when multiple configs reference the same connection", () => {
    expect(() =>
      buildIdentityLinkingConnectionRows([
        createProvider({
          configs: [
            createConfig({
              organizationProviderConfigId: "ilp_first",
              integrationConnectionId: "icn_github_engineering",
            }),
            createConfig({
              organizationProviderConfigId: "ilp_second",
              integrationConnectionId: "icn_github_engineering",
            }),
          ],
        }),
      ]),
    ).toThrow(
      "Identity-linking provider 'github' returned multiple configurations for connection 'icn_github_engineering'.",
    );
  });
});

describe("buildProviderRow", () => {
  it("returns a connection-scoped row model", () => {
    const [row] = buildIdentityLinkingConnectionRows([
      createProvider({
        eligibleConnections: [
          createConnection({
            id: "icn_github_engineering",
            displayName: "GitHub Engineering",
          }),
        ],
        configs: [
          createConfig({
            organizationProviderConfigId: "ilp_github_engineering",
            integrationConnectionId: "icn_github_engineering",
            selectedConnection: createConnection({
              id: "icn_github_engineering",
              displayName: "GitHub Engineering",
            }),
            configurationStatus: "disabled",
          }),
        ],
      }),
    ]);

    if (row === undefined) {
      throw new Error("Expected connection row.");
    }

    const providerRow = buildProviderRow({
      configuringRowKey: null,
      statusUpdatingRowKey: null,
      row,
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
    });

    expect(providerRow.rowKey).toBe("github:icn_github_engineering");
    expect(providerRow.canOpenLinkedUsers).toBe(true);
    expect(providerRow.connectionLabel).toBe("GitHub Engineering");
    expect(providerRow.enabled).toBe(false);
    expect(providerRow.linkedUsersCount).toBe(1);
    expect(providerRow.unavailableMessage).toBeNull();
  });

  it("marks unavailable rows when configured connections are no longer eligible", () => {
    const rows = buildIdentityLinkingConnectionRows([
      createProvider({
        eligibleConnections: [],
        configs: [
          createConfig({
            organizationProviderConfigId: "ilp_github_engineering",
            integrationConnectionId: "icn_github_engineering",
            selectedConnection: createConnection({
              id: "icn_github_engineering",
              displayName: "GitHub Engineering",
            }),
          }),
        ],
      }),
    ]);
    const row = rows[0];
    if (row === undefined) {
      throw new Error("Expected unavailable connection row.");
    }

    const providerRow = buildProviderRow({
      configuringRowKey: null,
      statusUpdatingRowKey: null,
      row,
      providerLinksQuery: null,
    });

    expect(providerRow.connectionLabel).toBe("GitHub Engineering");
    expect(providerRow.unavailableMessage).toBe(
      "This connection is no longer active. Disable identity linking or reconnect it.",
    );
  });

  it("marks providers without eligible connections as disabled rows", () => {
    const [row] = buildIdentityLinkingConnectionRows([
      createProvider({
        eligibleConnections: [],
        configs: [],
      }),
    ]);
    if (row === undefined) {
      throw new Error("Expected provider row.");
    }

    const providerRow = buildProviderRow({
      configuringRowKey: null,
      statusUpdatingRowKey: null,
      row,
      providerLinksQuery: null,
    });

    expect(providerRow.connectionLabel).toBe("No eligible active connections");
    expect(providerRow.enabled).toBe(false);
    expect(providerRow.unavailableMessage).toBe(
      "Add an active connection before enabling identity linking.",
    );
  });
});

function createProvider(
  overrides: Partial<OrganizationIdentityLinkProvider> = {},
): OrganizationIdentityLinkProvider {
  const selectedConnection = createConnection({
    id: "icn_github_engineering",
    displayName: "GitHub Engineering",
  });

  return {
    providerFamily: "github",
    organizationProviderConfigId: "ilp_github_engineering",
    integrationConnectionId: "icn_github_engineering",
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
        organizationProviderConfigId: "ilp_github_engineering",
        integrationConnectionId: "icn_github_engineering",
      }),
    ],
    ...overrides,
  };
}

function createConfig(
  overrides: Partial<OrganizationIdentityLinkProviderConfig> = {},
): OrganizationIdentityLinkProviderConfig {
  const selectedConnection = createConnection({
    id: overrides.integrationConnectionId ?? "icn_github_engineering",
    displayName: "GitHub Engineering",
  });

  return {
    organizationProviderConfigId: "ilp_github_engineering",
    integrationConnectionId: "icn_github_engineering",
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
