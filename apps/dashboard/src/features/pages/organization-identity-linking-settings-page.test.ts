import { describe, expect, it } from "vitest";

import { buildProviderCard } from "./organization-identity-linking-settings-page.js";

describe("buildProviderCard", () => {
  it("hides the status action when the selected connection differs from the saved config", () => {
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
      selectedConnectionIdByProviderFamily: {
        github: "icn_github_new",
      },
    });

    expect(providerCard.selectedConnectionId).toBe("icn_github_new");
    expect(providerCard.statusActionVisible).toBe(false);
  });
});
