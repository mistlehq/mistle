import { describe, expect, it } from "vitest";

import { buildProviderCard } from "./organization-identity-linking-settings-page.js";

describe("buildProviderCard", () => {
  it("returns an autosave row model when the selected connection differs from the saved config", () => {
    const providerCard = buildProviderCard({
      actionErrorMessageByProviderFamily: {},
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

    expect(providerCard.selectedConnectionId).toBe("icn_github_new");
    expect(providerCard.enabled).toBe(false);
    expect(providerCard.connectionOptions).toEqual([
      {
        id: "icn_github_new",
        label: "GitHub New · GitHub App installation",
      },
      {
        id: "icn_github_saved",
        label: "GitHub Saved · GitHub App installation",
      },
    ]);
    expect(providerCard.linkedUsersCount).toBe(1);
    expect(providerCard.memberLinks).toEqual([
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
});
