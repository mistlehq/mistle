import { describe, expect, it } from "vitest";

import {
  canManageOrganizationIdentityLinking,
  formatIdentityLinkEligibleConnectionLabel,
  formatIdentityLinkProviderMemberStatus,
  formatIdentityLinkProviderPrincipalSummary,
  formatIdentityLinkProviderConfigurationStatus,
  listEligibleIdentityLinkConnections,
  resolveIdentityLinkConfigureActionLabel,
  resolveReturnedIdentityLinkConnectionSelection,
  resolveIdentityLinkStatusActionLabel,
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

  it("formats provider state and primary actions", () => {
    expect(
      formatIdentityLinkProviderConfigurationStatus({
        configurationStatus: "active",
      }),
    ).toBe("Enabled");
    expect(
      formatIdentityLinkProviderConfigurationStatus({
        configurationStatus: "disabled",
      }),
    ).toBe("Disabled");
    expect(
      formatIdentityLinkProviderConfigurationStatus({
        configurationStatus: "unconfigured",
      }),
    ).toBe("Not enabled");

    expect(resolveIdentityLinkConfigureActionLabel()).toBe("Save");

    expect(
      resolveIdentityLinkStatusActionLabel({
        configurationStatus: "active",
      }),
    ).toBe("Disable");
    expect(
      resolveIdentityLinkStatusActionLabel({
        configurationStatus: "disabled",
      }),
    ).toBe("Enable");
    expect(
      resolveIdentityLinkStatusActionLabel({
        configurationStatus: "unconfigured",
      }),
    ).toBe("Enable");
  });

  it("resolves which provider should preselect a newly created connection", () => {
    expect(
      resolveReturnedIdentityLinkConnectionSelection({
        connectionId: "icn_1",
        providers: [
          {
            providerFamily: "github",
            organizationProviderConfigId: "ilp_github",
            integrationConnectionId: "icn_1",
            displayName: "GitHub",
            logoKey: "github",
            eligibleTargetKeys: ["github-cloud"],
            eligibleConnectionMethodIds: ["github-app-installation"],
            eligibleConnections: [
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
            configurationStatus: "active",
            selectedConnection: null,
            configuredAt: null,
            updatedAt: null,
          },
        ],
      }),
    ).toEqual({
      providerFamily: "github",
      integrationConnectionId: "icn_1",
    });

    expect(
      resolveReturnedIdentityLinkConnectionSelection({
        connectionId: "icn_2",
        providers: [
          {
            providerFamily: "github",
            organizationProviderConfigId: null,
            integrationConnectionId: null,
            displayName: "GitHub",
            logoKey: "github",
            eligibleTargetKeys: ["github-cloud"],
            eligibleConnectionMethodIds: ["github-app-installation"],
            eligibleConnections: [],
            configurationStatus: "unconfigured",
            selectedConnection: null,
            configuredAt: null,
            updatedAt: null,
          },
        ],
      }),
    ).toBeNull();
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

    expect(
      formatIdentityLinkProviderPrincipalSummary({
        link: {
          userId: "usr_123",
          name: "Owner User",
          email: "owner@example.com",
          linked: true,
          principalSummary: {
            providerSubjectId: "github-owner-123",
            login: "owner-github",
            displayName: "Owner GitHub",
            email: "owner@example.com",
          },
          updatedAt: "2026-04-20T00:00:00.000Z",
        },
      }),
    ).toBe("Owner GitHub");

    expect(
      formatIdentityLinkProviderPrincipalSummary({
        link: {
          userId: "usr_124",
          name: "Member User",
          email: "member@example.com",
          linked: false,
          principalSummary: null,
          updatedAt: null,
        },
      }),
    ).toBeNull();
  });
});
