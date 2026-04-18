import { describe, expect, it } from "vitest";

import {
  canManageOrganizationIdentityLinking,
  formatIdentityLinkEligibleConnectionLabel,
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

  it("filters eligible active connections by target and method", () => {
    const connections = listEligibleIdentityLinkConnections({
      connections: [
        {
          id: "icn_2",
          targetKey: "github-cloud",
          displayName: "Archive GitHub",
          status: "error",
          connectionMethodId: "github-app-installation",
          connectionMethodLabel: "GitHub App installation",
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
        {
          id: "icn_3",
          targetKey: "slack-default",
          displayName: "Slack App",
          status: "active",
          connectionMethodId: "slack-bot-token",
          connectionMethodLabel: "Slack bot token",
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
      provider: {
        providerFamily: "github",
        displayName: "GitHub",
        logoKey: "github",
        eligibleTargetKeys: ["github-cloud"],
        eligibleConnectionMethodIds: ["github-app-installation"],
        configurationStatus: "unconfigured",
        selectedConnection: null,
        configuredAt: null,
        updatedAt: null,
      },
    });

    expect(connections).toEqual([
      {
        id: "icn_1",
        targetKey: "github-cloud",
        displayName: "Engineering GitHub",
        connectionMethodId: "github-app-installation",
        connectionMethodLabel: "GitHub App installation",
      },
    ]);
    expect(formatIdentityLinkEligibleConnectionLabel(connections[0]!)).toBe(
      "Engineering GitHub · GitHub App installation",
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
        connections: [
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
        providers: [
          {
            providerFamily: "github",
            displayName: "GitHub",
            logoKey: "github",
            eligibleTargetKeys: ["github-cloud"],
            eligibleConnectionMethodIds: ["github-app-installation"],
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
        connections: [
          {
            id: "icn_2",
            targetKey: "slack-default",
            displayName: "Slack",
            status: "active",
            connectionMethodId: "slack-bot-token",
            connectionMethodLabel: "Slack bot token",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
        providers: [
          {
            providerFamily: "github",
            displayName: "GitHub",
            logoKey: "github",
            eligibleTargetKeys: ["github-cloud"],
            eligibleConnectionMethodIds: ["github-app-installation"],
            configurationStatus: "unconfigured",
            selectedConnection: null,
            configuredAt: null,
            updatedAt: null,
          },
        ],
      }),
    ).toBeNull();
  });
});
