import { describe, expect, it } from "vitest";

import {
  buildSessionsSidebarNavItems,
  filterSessionsSidebarNavItems,
  type SessionsSidebarSourceItem,
} from "./sessions-sidebar-nav-model.js";

function buildSourceItem(
  overrides: Partial<SessionsSidebarSourceItem> & Pick<SessionsSidebarSourceItem, "id">,
): SessionsSidebarSourceItem {
  const { id, ...restOverrides } = overrides;

  return {
    id,
    title: null,
    sandboxProfileId: "sbp_profile_alpha",
    sandboxProfileDisplayName: "Alpha Profile",
    status: "running",
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
    keepaliveActive: false,
    ...restOverrides,
  };
}

describe("buildSessionsSidebarNavItems", () => {
  it("preserves API order and only removes navigation from failed sessions", () => {
    expect(
      buildSessionsSidebarNavItems(
        [
          buildSourceItem({
            id: "sbi_working",
            title: "Investigate flaky test run",
            keepaliveActive: true,
          }),
          buildSourceItem({
            id: "sbi_ready",
            title: "Review migration draft",
            keepaliveActive: false,
          }),
          buildSourceItem({
            id: "sbi_stopped",
            sandboxProfileId: "sbp_profile_beta",
            sandboxProfileDisplayName: "Beta Profile",
            status: "stopped",
          }),
          buildSourceItem({
            id: "sbi_failed",
            sandboxProfileId: "sbp_profile_gamma",
            sandboxProfileDisplayName: "Gamma Profile",
            status: "failed",
          }),
        ],
        {
          nowEpochMs: Date.parse("2026-04-10T00:00:00.000Z"),
        },
      ),
    ).toStrictEqual([
      {
        id: "sbi_working",
        label: "Investigate flaky test run",
        profileName: "Alpha Profile",
        status: "running",
        updatedAtLabel: "2d",
        to: "/sessions/sbi_working",
      },
      {
        id: "sbi_ready",
        label: "Review migration draft",
        profileName: "Alpha Profile",
        status: "running",
        updatedAtLabel: "2d",
        to: "/sessions/sbi_ready",
      },
      {
        id: "sbi_stopped",
        label: "Untitled",
        profileName: "Beta Profile",
        status: "stopped",
        updatedAtLabel: "2d",
        to: "/sessions/sbi_stopped",
      },
      {
        id: "sbi_failed",
        label: "Untitled",
        profileName: "Gamma Profile",
        status: "failed",
        updatedAtLabel: "2d",
      },
    ]);
  });
});

describe("filterSessionsSidebarNavItems", () => {
  const items = buildSessionsSidebarNavItems(
    [
      buildSourceItem({
        id: "sbi_docs",
        title: "Draft onboarding guide",
        sandboxProfileId: "sbp_docs",
        sandboxProfileDisplayName: "Docs Maintainer",
        status: "starting",
        updatedAt: "2026-04-09T23:00:00.000Z",
      }),
      buildSourceItem({
        id: "sbi_finance",
        title: null,
        sandboxProfileId: "sbp_finance",
        sandboxProfileDisplayName: "Finance Investigator",
        status: "stopped",
        updatedAt: "2026-04-08T00:00:00.000Z",
      }),
      buildSourceItem({
        id: "sbi_repo_active",
        title: "Investigate flaky test run",
        sandboxProfileId: "sbp_repo",
        sandboxProfileDisplayName: "Repo Maintainer",
        keepaliveActive: true,
      }),
      buildSourceItem({
        id: "sbi_repo_idle",
        title: "Review migration draft",
        sandboxProfileId: "sbp_repo",
        sandboxProfileDisplayName: "Repo Maintainer",
        updatedAt: "2026-04-08T00:00:00.000Z",
      }),
    ],
    {
      nowEpochMs: Date.parse("2026-04-10T00:00:00.000Z"),
    },
  );

  it("returns the original groups when the query is empty", () => {
    expect(
      filterSessionsSidebarNavItems({
        items,
        searchFilter: {
          searchQuery: "   ",
        },
      }),
    ).toStrictEqual(items);
  });

  it("matches items by session title", () => {
    expect(
      filterSessionsSidebarNavItems({
        items,
        searchFilter: {
          searchQuery: "draft",
        },
      }),
    ).toStrictEqual([
      {
        id: "sbi_docs",
        label: "Draft onboarding guide",
        profileName: "Docs Maintainer",
        status: "starting",
        updatedAtLabel: "1h",
        to: "/sessions/sbi_docs",
      },
      {
        id: "sbi_repo_idle",
        label: "Review migration draft",
        profileName: "Repo Maintainer",
        status: "running",
        updatedAtLabel: "2d",
        to: "/sessions/sbi_repo_idle",
      },
    ]);
  });

  it("matches items by profile name", () => {
    expect(
      filterSessionsSidebarNavItems({
        items,
        searchFilter: {
          searchQuery: "finance",
        },
      }),
    ).toStrictEqual([
      {
        id: "sbi_finance",
        label: "Untitled",
        profileName: "Finance Investigator",
        status: "stopped",
        updatedAtLabel: "2d",
        to: "/sessions/sbi_finance",
      },
    ]);
  });
});
