import { describe, expect, it } from "vitest";

import type { SessionSidebarGroup } from "../sessions/sessions-types.js";
import {
  buildSessionsShellSidebarItems,
  resolveSessionsShellSidebarHasMore,
} from "./sessions-shell-sidebar.js";

function buildSessionSidebarGroup(
  overrides: Partial<SessionSidebarGroup> & Pick<SessionSidebarGroup, "profileId">,
): SessionSidebarGroup {
  const { profileId, ...restOverrides } = overrides;

  return {
    profileId,
    profileName: "Default Profile",
    items: [],
    ...restOverrides,
  };
}

describe("buildSessionsShellSidebarItems", () => {
  it("maps listed sandbox instances into a globally recent flat session list", () => {
    expect(
      buildSessionsShellSidebarItems(
        [
          buildSessionSidebarGroup({
            profileId: "sbp_default",
            profileName: "Default Profile",
            items: [
              {
                id: "sbi_active",
                title: "Investigate flaky test run",
                status: "running",
                updatedAt: "2026-04-08T00:00:00.000Z",
                keepaliveActive: true,
              },
            ],
          }),
          buildSessionSidebarGroup({
            profileId: "sbp_docs",
            profileName: "Docs",
            items: [
              {
                id: "sbi_setup",
                title: "Draft onboarding guide",
                status: "starting",
                updatedAt: "2026-04-09T00:00:00.000Z",
                keepaliveActive: false,
              },
            ],
          }),
          buildSessionSidebarGroup({
            profileId: "sbp_failed",
            profileName: "Broken",
            items: [
              {
                id: "sbi_failed",
                title: null,
                status: "failed",
                updatedAt: "2026-04-08T00:00:00.000Z",
                keepaliveActive: false,
              },
            ],
          }),
        ],
        {
          nowEpochMs: Date.parse("2026-04-10T00:00:00.000Z"),
        },
      ),
    ).toStrictEqual([
      {
        id: "sbi_setup",
        label: "Draft onboarding guide",
        profileName: "Docs",
        metadataLabel: "1d",
        to: "/sessions/sbi_setup",
        showActivityIndicator: false,
        updatedAt: "2026-04-09T00:00:00.000Z",
      },
      {
        id: "sbi_active",
        label: "Investigate flaky test run",
        profileName: "Default Profile",
        metadataLabel: "Working",
        to: "/sessions/sbi_active",
        showActivityIndicator: true,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
    ]);
  });
});

describe("resolveSessionsShellSidebarHasMore", () => {
  it("keeps loading while the fetched item count still fills the requested limit", () => {
    expect(
      resolveSessionsShellSidebarHasMore({
        itemCount: 30,
        resolvedLimit: 30,
      }),
    ).toBe(true);
  });

  it("stops loading when the fetched item count falls short of the requested limit", () => {
    expect(
      resolveSessionsShellSidebarHasMore({
        itemCount: 42,
        resolvedLimit: 60,
      }),
    ).toBe(false);
  });
});
