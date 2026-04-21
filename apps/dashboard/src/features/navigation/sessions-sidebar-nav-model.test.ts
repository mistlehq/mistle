import { describe, expect, it } from "vitest";

import {
  buildSidebarSessionNavItems,
  filterSessionsSidebarNavItems,
  resolveSessionsSidebarShowActivityIndicator,
  type SidebarSessionItem,
} from "./sessions-sidebar-nav-model.js";

function buildSourceItem(
  overrides: Partial<SidebarSessionItem> & Pick<SidebarSessionItem, "id" | "profileName">,
): SidebarSessionItem {
  const { id, profileName, ...restOverrides } = overrides;

  return {
    id,
    title: null,
    profileName,
    status: "running",
    updatedAt: "2026-04-08T00:00:00.000Z",
    keepaliveActive: false,
    ...restOverrides,
  };
}

describe("resolveSessionsSidebarShowActivityIndicator", () => {
  it("shows activity only for running sessions with active keepalive", () => {
    expect(
      resolveSessionsSidebarShowActivityIndicator({
        status: "running",
        keepaliveActive: true,
      }),
    ).toBe(true);
  });

  it("hides activity for running sessions without keepalive", () => {
    expect(
      resolveSessionsSidebarShowActivityIndicator({
        status: "running",
        keepaliveActive: false,
      }),
    ).toBe(false);
  });

  it("hides activity for openable sessions that are not actively running work", () => {
    expect(
      resolveSessionsSidebarShowActivityIndicator({
        status: "stopped",
        keepaliveActive: false,
      }),
    ).toBe(false);
    expect(
      resolveSessionsSidebarShowActivityIndicator({
        status: "starting",
        keepaliveActive: false,
      }),
    ).toBe(false);
  });

  it("hides activity for failed sessions", () => {
    expect(
      resolveSessionsSidebarShowActivityIndicator({
        status: "failed",
        keepaliveActive: false,
      }),
    ).toBe(false);
  });
});

describe("buildSidebarSessionNavItems", () => {
  it("maps nav fields while preserving backend order", () => {
    expect(
      buildSidebarSessionNavItems(
        [
          buildSourceItem({
            id: "sbi_working",
            profileName: "Beta Profile",
            title: "Investigate flaky test run",
            keepaliveActive: true,
            updatedAt: "2026-04-09T00:00:00.000Z",
          }),
          buildSourceItem({
            id: "sbi_ready",
            profileName: "Beta Profile",
            title: "Review migration draft",
            keepaliveActive: false,
            updatedAt: "2026-04-10T00:00:00.000Z",
          }),
          buildSourceItem({
            id: "sbi_stopped",
            profileName: "Alpha Profile",
            status: "stopped",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }),
          buildSourceItem({
            id: "sbi_failed",
            profileName: "Alpha Profile",
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
        profileName: "Beta Profile",
        metadataLabel: "Working",
        to: "/sessions/sbi_working",
        showActivityIndicator: true,
        updatedAt: "2026-04-09T00:00:00.000Z",
      },
      {
        id: "sbi_ready",
        label: "Review migration draft",
        profileName: "Beta Profile",
        metadataLabel: "Idle",
        to: "/sessions/sbi_ready",
        showActivityIndicator: false,
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
      {
        id: "sbi_stopped",
        label: "Untitled",
        profileName: "Alpha Profile",
        metadataLabel: "2d",
        to: "/sessions/sbi_stopped",
        showActivityIndicator: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
      {
        id: "sbi_failed",
        label: "Untitled",
        profileName: "Alpha Profile",
        metadataLabel: "Failed",
        to: "/sessions/sbi_failed",
        showActivityIndicator: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
    ]);
  });
});

describe("filterSessionsSidebarNavItems", () => {
  const items = buildSidebarSessionNavItems(
    [
      buildSourceItem({
        id: "sbi_docs",
        profileName: "Docs Maintainer",
        title: "Draft onboarding guide",
        status: "starting",
        updatedAt: "2026-04-09T23:00:00.000Z",
      }),
      buildSourceItem({
        id: "sbi_finance",
        profileName: "Finance Investigator",
        title: null,
        status: "stopped",
        updatedAt: "2026-04-08T00:00:00.000Z",
      }),
      buildSourceItem({
        id: "sbi_repo_active",
        profileName: "Repo Maintainer",
        title: "Investigate flaky test run",
        keepaliveActive: true,
      }),
      buildSourceItem({
        id: "sbi_repo_idle",
        profileName: "Repo Maintainer",
        title: "Review migration draft",
        updatedAt: "2026-04-08T00:00:00.000Z",
      }),
    ],
    {
      nowEpochMs: Date.parse("2026-04-10T00:00:00.000Z"),
    },
  );

  it("returns the original item list when the query is empty", () => {
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
        metadataLabel: "1h",
        to: "/sessions/sbi_docs",
        showActivityIndicator: false,
        updatedAt: "2026-04-09T23:00:00.000Z",
      },
      {
        id: "sbi_repo_idle",
        label: "Review migration draft",
        profileName: "Repo Maintainer",
        metadataLabel: "Idle",
        to: "/sessions/sbi_repo_idle",
        showActivityIndicator: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
    ]);
  });

  it("matches items by profile name", () => {
    expect(
      filterSessionsSidebarNavItems({
        items,
        searchFilter: {
          searchQuery: "repo",
        },
      }),
    ).toStrictEqual([
      {
        id: "sbi_repo_active",
        label: "Investigate flaky test run",
        profileName: "Repo Maintainer",
        metadataLabel: "Working",
        to: "/sessions/sbi_repo_active",
        showActivityIndicator: true,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
      {
        id: "sbi_repo_idle",
        label: "Review migration draft",
        profileName: "Repo Maintainer",
        metadataLabel: "Idle",
        to: "/sessions/sbi_repo_idle",
        showActivityIndicator: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
    ]);
  });

  it("breaks equal updatedAt ties by id for deterministic order", () => {
    expect(items.map((item) => item.id)).toStrictEqual([
      "sbi_docs",
      "sbi_finance",
      "sbi_repo_active",
      "sbi_repo_idle",
    ]);
  });
});
