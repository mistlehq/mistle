import { describe, expect, it } from "vitest";

import {
  canManageOrganizationIdentityLinking,
  formatIdentityLinkEligibleConnectionLabel,
  formatIdentityLinkProviderMemberStatus,
  listEligibleIdentityLinkConnections,
} from "./organization-identity-linking-model.js";

describe("organization identity linking model", () => {
  it("allows only owners and admins to manage identity linking", () => {
    expect(canManageOrganizationIdentityLinking({ actorRole: "owner" })).toBe(true);
    expect(canManageOrganizationIdentityLinking({ actorRole: "admin" })).toBe(true);
    expect(canManageOrganizationIdentityLinking({ actorRole: "member" })).toBe(false);
  });

  it("maps and sorts provider-supplied eligible connections", () => {
    const connections = listEligibleIdentityLinkConnections({
      provider: {
        providerFamily: "github",
        organizationProviderConfigId: null,
        integrationConnectionId: null,
        displayName: "GitHub",
        logoKey: "github",
        eligibleTargetKeys: ["github-cloud"],
        eligibleConnectionMethodIds: ["github-app-installation"],
        eligibleConnections: [
          {
            id: "icn_2",
            targetKey: "github-cloud",
            displayName: "Archive GitHub",
            status: "active",
            connectionMethodId: "github-app-installation",
            connectionMethodLabel: "GitHub App installation",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
          {
            id: "icn_1",
            targetKey: "github-cloud",
            displayName: "Engineering GitHub",
            status: "active",
            connectionMethodId: "github-app-installation",
            connectionMethodLabel: "GitHub App installation",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
        configurationStatus: "unconfigured",
        selectedConnection: null,
        configuredAt: null,
        updatedAt: null,
      },
    });

    expect(connections).toEqual([
      {
        id: "icn_2",
        targetKey: "github-cloud",
        displayName: "Archive GitHub",
        connectionMethodId: "github-app-installation",
        connectionMethodLabel: "GitHub App installation",
      },
      {
        id: "icn_1",
        targetKey: "github-cloud",
        displayName: "Engineering GitHub",
        connectionMethodId: "github-app-installation",
        connectionMethodLabel: "GitHub App installation",
      },
    ]);
    expect(formatIdentityLinkEligibleConnectionLabel(connections[0]!)).toBe(
      "Archive GitHub · GitHub App installation",
    );
  });

  it("formats provider member visibility rows", () => {
    expect(
      formatIdentityLinkProviderMemberStatus({
        linked: true,
      }),
    ).toBe("Linked");
    expect(
      formatIdentityLinkProviderMemberStatus({
        linked: false,
      }),
    ).toBe("Not linked");
  });
});
