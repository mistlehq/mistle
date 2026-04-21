import { describe, expect, it } from "vitest";

import {
  buildSessionSidebarGroups,
  type EnrichedListedItem,
} from "./build-session-sidebar-groups.js";

function buildEnrichedListedItem(
  overrides: Partial<EnrichedListedItem> &
    Pick<EnrichedListedItem, "id" | "sandboxProfileId" | "status">,
): EnrichedListedItem {
  const { id, sandboxProfileId, status, ...restOverrides } = overrides;

  return {
    id,
    sandboxProfileId,
    title: null,
    sandboxProfileDisplayName: "Default Profile",
    sandboxProfileVersion: 1,
    status,
    keepaliveActive: false,
    startedBy: {
      kind: "user",
      id: "usr_default",
      name: "Default User",
    },
    source: "dashboard",
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
    failureCode: null,
    failureMessage: null,
    ...restOverrides,
  };
}

describe("buildSessionSidebarGroups", () => {
  it("keeps failed sessions in the sidebar groups so limit semantics stay truthful", () => {
    expect(
      buildSessionSidebarGroups([
        buildEnrichedListedItem({
          id: "sbi_failed",
          sandboxProfileId: "sbp_default",
          status: "failed",
          updatedAt: "2026-04-10T00:00:00.000Z",
          title: "Investigate broken environment bootstrap",
        }),
        buildEnrichedListedItem({
          id: "sbi_running",
          sandboxProfileId: "sbp_default",
          status: "running",
          updatedAt: "2026-04-09T00:00:00.000Z",
          title: "Refactor sidebar query invalidation",
          keepaliveActive: true,
        }),
      ]),
    ).toStrictEqual([
      {
        profileId: "sbp_default",
        profileName: "Default Profile",
        items: [
          {
            id: "sbi_failed",
            title: "Investigate broken environment bootstrap",
            status: "failed",
            keepaliveActive: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
          },
          {
            id: "sbi_running",
            title: "Refactor sidebar query invalidation",
            status: "running",
            keepaliveActive: true,
            updatedAt: "2026-04-09T00:00:00.000Z",
          },
        ],
      },
    ]);
  });
});
