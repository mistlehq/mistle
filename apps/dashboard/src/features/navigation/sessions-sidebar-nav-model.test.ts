import { describe, expect, it } from "vitest";

import {
  buildSessionsSidebarNavGroups,
  filterSessionsSidebarNavGroups,
  resolveSessionsSidebarShowActivityIndicator,
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

  it("excludes failed sessions from the sidebar", () => {
    expect(
      resolveSessionsSidebarShowActivityIndicator({
        status: "failed",
        keepaliveActive: false,
      }),
    ).toBeNull();
  });
});

describe("buildSessionsSidebarNavGroups", () => {
  it("groups only openable sessions by sandbox profile", () => {
    expect(
      buildSessionsSidebarNavGroups(
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
        profileId: "sbp_profile_alpha",
        profileName: "Alpha Profile",
        items: [
          {
            id: "sbi_working",
            label: "Investigate flaky test run",
            metadataLabel: "Working",
            to: "/sessions/sbi_working",
            showActivityIndicator: true,
          },
          {
            id: "sbi_ready",
            label: "Review migration draft",
            metadataLabel: "Idle",
            to: "/sessions/sbi_ready",
            showActivityIndicator: false,
          },
        ],
      },
      {
        profileId: "sbp_profile_beta",
        profileName: "Beta Profile",
        items: [
          {
            id: "sbi_stopped",
            label: "Untitled",
            metadataLabel: "2d",
            to: "/sessions/sbi_stopped",
            showActivityIndicator: false,
          },
        ],
      },
    ]);
  });
});

describe("filterSessionsSidebarNavGroups", () => {
  const groups = buildSessionsSidebarNavGroups(
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
      filterSessionsSidebarNavGroups({
        groups,
        searchFilter: {
          searchQuery: "   ",
        },
      }),
    ).toStrictEqual(groups);
  });

  it("matches items by session title", () => {
    expect(
      filterSessionsSidebarNavGroups({
        groups,
        searchFilter: {
          searchQuery: "draft",
        },
      }),
    ).toStrictEqual([
      {
        profileId: "sbp_docs",
        profileName: "Docs Maintainer",
        items: [
          {
            id: "sbi_docs",
            label: "Draft onboarding guide",
            metadataLabel: "1h",
            to: "/sessions/sbi_docs",
            showActivityIndicator: false,
          },
        ],
      },
      {
        profileId: "sbp_repo",
        profileName: "Repo Maintainer",
        items: [
          {
            id: "sbi_repo_idle",
            label: "Review migration draft",
            metadataLabel: "Idle",
            to: "/sessions/sbi_repo_idle",
            showActivityIndicator: false,
          },
        ],
      },
    ]);
  });

  it("matches items by profile name", () => {
    expect(
      filterSessionsSidebarNavGroups({
        groups,
        searchFilter: {
          searchQuery: "finance",
        },
      }),
    ).toStrictEqual([
      {
        profileId: "sbp_finance",
        profileName: "Finance Investigator",
        items: [
          {
            id: "sbi_finance",
            label: "Untitled",
            metadataLabel: "2d",
            to: "/sessions/sbi_finance",
            showActivityIndicator: false,
          },
        ],
      },
    ]);
  });
});
