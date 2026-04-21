import { describe, expect, it } from "vitest";

import type { SessionSidebarGroup } from "../sessions/sessions-types.js";
import { buildSessionsShellSidebarGroups } from "./sessions-shell-sidebar.js";

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

describe("buildSessionsShellSidebarGroups", () => {
  it("maps listed sandbox instances into grouped session sidebar items", () => {
    expect(
      buildSessionsShellSidebarGroups(
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
                updatedAt: "2026-04-08T00:00:00.000Z",
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
        profileId: "sbp_default",
        profileName: "Default Profile",
        items: [
          {
            id: "sbi_active",
            label: "Investigate flaky test run",
            metadataLabel: "Working",
            to: "/sessions/sbi_active",
            showActivityIndicator: true,
            updatedAt: "2026-04-08T00:00:00.000Z",
          },
        ],
      },
      {
        profileId: "sbp_docs",
        profileName: "Docs",
        items: [
          {
            id: "sbi_setup",
            label: "Draft onboarding guide",
            metadataLabel: "2d",
            to: "/sessions/sbi_setup",
            showActivityIndicator: false,
            updatedAt: "2026-04-08T00:00:00.000Z",
          },
        ],
      },
    ]);
  });
});
