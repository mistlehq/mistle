import { describe, expect, it } from "vitest";

import {
  buildSessionsSidebarNavGroups,
  filterSessionsSidebarNavGroups,
  resolveSessionsSidebarAttentionState,
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
    keepaliveActive: false,
    ...restOverrides,
  };
}

describe("resolveSessionsSidebarAttentionState", () => {
  it("treats active keepalive on running sessions as active", () => {
    expect(
      resolveSessionsSidebarAttentionState({
        status: "running",
        keepaliveActive: true,
      }),
    ).toBe("active");
  });

  it("treats running sessions without keepalive as idle", () => {
    expect(
      resolveSessionsSidebarAttentionState({
        status: "running",
        keepaliveActive: false,
      }),
    ).toBe("idle");
  });

  it("treats stopped sessions as idle and ready for more input", () => {
    expect(
      resolveSessionsSidebarAttentionState({
        status: "stopped",
        keepaliveActive: false,
      }),
    ).toBe("idle");
  });

  it("treats pending or starting sessions as setup", () => {
    expect(
      resolveSessionsSidebarAttentionState({
        status: "starting",
        keepaliveActive: false,
      }),
    ).toBe("setup");
  });

  it("excludes failed sessions from the sidebar", () => {
    expect(
      resolveSessionsSidebarAttentionState({
        status: "failed",
        keepaliveActive: false,
      }),
    ).toBeNull();
  });
});

describe("buildSessionsSidebarNavGroups", () => {
  it("groups only openable sessions by sandbox profile", () => {
    expect(
      buildSessionsSidebarNavGroups([
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
      ]),
    ).toStrictEqual([
      {
        profileId: "sbp_profile_alpha",
        profileName: "Alpha Profile",
        items: [
          {
            id: "sbi_working",
            label: "Investigate flaky test run",
            to: "/sessions/sbi_working",
            attentionState: "active",
          },
          {
            id: "sbi_ready",
            label: "Review migration draft",
            to: "/sessions/sbi_ready",
            attentionState: "idle",
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
            to: "/sessions/sbi_stopped",
            attentionState: "idle",
          },
        ],
      },
    ]);
  });
});

describe("filterSessionsSidebarNavGroups", () => {
  const groups = buildSessionsSidebarNavGroups([
    buildSourceItem({
      id: "sbi_docs",
      title: "Draft onboarding guide",
      sandboxProfileId: "sbp_docs",
      sandboxProfileDisplayName: "Docs Maintainer",
      status: "starting",
    }),
    buildSourceItem({
      id: "sbi_finance",
      title: null,
      sandboxProfileId: "sbp_finance",
      sandboxProfileDisplayName: "Finance Investigator",
      status: "stopped",
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
    }),
  ]);

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
            to: "/sessions/sbi_docs",
            attentionState: "setup",
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
            to: "/sessions/sbi_repo_idle",
            attentionState: "idle",
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
            to: "/sessions/sbi_finance",
            attentionState: "idle",
          },
        ],
      },
    ]);
  });
});
