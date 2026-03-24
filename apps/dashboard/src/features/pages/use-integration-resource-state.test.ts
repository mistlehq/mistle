import { describe, expect, it } from "vitest";

import { shouldPollIntegrationDirectory } from "./use-integration-resource-state.js";

describe("useIntegrationResourceState helpers", () => {
  it("polls the directory while the active detail connection is syncing", () => {
    expect(
      shouldPollIntegrationDirectory({
        activeDetailConnectionId: "icn_syncing",
        detailTargetKey: "github",
        directoryData: {
          targets: [
            {
              targetKey: "github",
              familyId: "github",
              variantId: "github-cloud",
              enabled: true,
              config: {},
              displayName: "GitHub",
              description: "GitHub",
              targetHealth: {
                configStatus: "valid",
              },
            },
          ],
          connections: [
            {
              id: "icn_syncing",
              targetKey: "github",
              displayName: "Engineering GitHub",
              status: "active",
              bindingCount: 0,
              createdAt: "2026-03-03T00:00:00.000Z",
              updatedAt: "2026-03-11T04:30:00.000Z",
              resources: [
                {
                  kind: "repositories",
                  selectionMode: "multi",
                  count: 42,
                  syncState: "syncing",
                },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it("does not poll when there is no detail target or no directory data", () => {
    expect(
      shouldPollIntegrationDirectory({
        activeDetailConnectionId: null,
        detailTargetKey: null,
        directoryData: undefined,
      }),
    ).toBe(false);
  });
});
