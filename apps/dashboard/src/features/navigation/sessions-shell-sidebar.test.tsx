import { describe, expect, it } from "vitest";

import type {
  SandboxInstanceListItem,
  SandboxInstancesListResult,
} from "../sessions/sessions-types.js";
import {
  buildSidebarSessionItems,
  buildSidebarSessionNavItems,
  dedupeSidebarSessionItems,
  filterSidebarPrependedItems,
  flattenSidebarSessionPages,
  prependSidebarSessionItems,
  resolveSidebarHeadRefresh,
  resolveSidebarSessionsHasMore,
  resolveSidebarSessionsNextCursor,
} from "./sessions-shell-sidebar.js";

function buildSandboxInstanceListItem(
  overrides: Partial<SandboxInstanceListItem> & Pick<SandboxInstanceListItem, "id">,
): SandboxInstanceListItem {
  const { id, ...restOverrides } = overrides;

  return {
    id,
    title: null,
    sandboxProfileId: "sbp_default",
    sandboxProfileDisplayName: "Default Profile",
    sandboxProfileVersion: 1,
    status: "running",
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

function buildSandboxInstancesPage(
  overrides?: Partial<SandboxInstancesListResult>,
): SandboxInstancesListResult {
  return {
    items: [],
    nextPage: null,
    previousPage: null,
    totalResults: 0,
    ...overrides,
  };
}

describe("buildSidebarSessionItems", () => {
  it("maps sandbox instances into flat sidebar session items", () => {
    expect(
      buildSidebarSessionItems([
        buildSandboxInstanceListItem({
          id: "sbi_active",
          title: "Investigate flaky test run",
          status: "running",
          keepaliveActive: true,
        }),
      ]),
    ).toStrictEqual([
      {
        id: "sbi_active",
        title: "Investigate flaky test run",
        profileName: "Default Profile",
        status: "running",
        updatedAt: "2026-04-08T00:00:00.000Z",
        keepaliveActive: true,
      },
    ]);
  });
});

describe("buildSidebarSessionNavItems", () => {
  it("preserves backend order while mapping nav fields", () => {
    expect(
      buildSidebarSessionNavItems({
        items: [
          buildSandboxInstanceListItem({
            id: "sbi_newest",
            title: "Newest created session",
            sandboxProfileDisplayName: "Ops",
            status: "starting",
            createdAt: "2026-04-10T00:00:00.000Z",
            updatedAt: "2026-04-10T00:00:00.000Z",
          }),
          buildSandboxInstanceListItem({
            id: "sbi_older",
            title: "Older created session",
            sandboxProfileDisplayName: "Docs",
            status: "failed",
            createdAt: "2026-04-09T00:00:00.000Z",
            updatedAt: "2026-04-09T00:00:00.000Z",
          }),
        ],
        nowEpochMs: Date.parse("2026-04-10T00:00:00.000Z"),
      }),
    ).toStrictEqual([
      {
        id: "sbi_newest",
        label: "Newest created session",
        profileName: "Ops",
        metadataLabel: "now",
        to: "/sessions/sbi_newest",
        showActivityIndicator: false,
        updatedAt: "2026-04-10T00:00:00.000Z",
      },
    ]);
  });
});

describe("flattenSidebarSessionPages", () => {
  it("appends items across loaded cursor pages", () => {
    expect(
      flattenSidebarSessionPages([
        buildSandboxInstancesPage({
          items: [buildSandboxInstanceListItem({ id: "sbi_page_one" })],
        }),
        buildSandboxInstancesPage({
          items: [buildSandboxInstanceListItem({ id: "sbi_page_two" })],
        }),
      ]),
    ).toStrictEqual([
      buildSandboxInstanceListItem({ id: "sbi_page_one" }),
      buildSandboxInstanceListItem({ id: "sbi_page_two" }),
    ]);
  });
});

describe("dedupeSidebarSessionItems", () => {
  it("keeps the first occurrence of each item id", () => {
    expect(
      dedupeSidebarSessionItems([
        buildSandboxInstanceListItem({ id: "sbi_newest" }),
        buildSandboxInstanceListItem({ id: "sbi_existing" }),
        buildSandboxInstanceListItem({ id: "sbi_newest", title: "Duplicate" }),
      ]),
    ).toStrictEqual([
      buildSandboxInstanceListItem({ id: "sbi_newest" }),
      buildSandboxInstanceListItem({ id: "sbi_existing" }),
    ]);
  });
});

describe("prependSidebarSessionItems", () => {
  it("prepends newer items without duplicating existing ids", () => {
    expect(
      prependSidebarSessionItems({
        currentItems: [
          buildSandboxInstanceListItem({ id: "sbi_head" }),
          buildSandboxInstanceListItem({ id: "sbi_existing" }),
        ],
        newerItems: [
          buildSandboxInstanceListItem({ id: "sbi_new_1" }),
          buildSandboxInstanceListItem({ id: "sbi_head", title: "Duplicate head" }),
        ],
      }),
    ).toStrictEqual([
      buildSandboxInstanceListItem({ id: "sbi_new_1" }),
      buildSandboxInstanceListItem({ id: "sbi_head", title: "Duplicate head" }),
      buildSandboxInstanceListItem({ id: "sbi_existing" }),
    ]);
  });
});

describe("filterSidebarPrependedItems", () => {
  it("drops prepended items once the base feed contains them", () => {
    expect(
      filterSidebarPrependedItems({
        prependedItems: [
          buildSandboxInstanceListItem({ id: "sbi_new_1" }),
          buildSandboxInstanceListItem({ id: "sbi_new_2" }),
        ],
        baseItems: [
          buildSandboxInstanceListItem({ id: "sbi_new_2" }),
          buildSandboxInstanceListItem({ id: "sbi_existing" }),
        ],
      }),
    ).toStrictEqual([buildSandboxInstanceListItem({ id: "sbi_new_1" })]);
  });
});

describe("resolveSidebarSessionsHasMore", () => {
  it("keeps loading while the latest page exposes a next cursor", () => {
    expect(
      resolveSidebarSessionsHasMore([
        buildSandboxInstancesPage({
          nextPage: {
            after: "cursor_2",
            limit: 25,
          },
        }),
      ]),
    ).toBe(true);
  });

  it("stops loading when the latest page has no next cursor", () => {
    expect(
      resolveSidebarSessionsHasMore([
        buildSandboxInstancesPage({
          nextPage: null,
        }),
      ]),
    ).toBe(false);
  });
});

describe("resolveSidebarSessionsNextCursor", () => {
  it("returns the next cursor from the latest loaded page", () => {
    expect(
      resolveSidebarSessionsNextCursor([
        buildSandboxInstancesPage({
          nextPage: {
            after: "cursor_3",
            limit: 25,
          },
        }),
      ]),
    ).toStrictEqual({
      after: "cursor_3",
      limit: 25,
    });
  });

  it("returns null when there is no next cursor", () => {
    expect(resolveSidebarSessionsNextCursor([])).toBeNull();
    expect(
      resolveSidebarSessionsNextCursor([
        buildSandboxInstancesPage({
          nextPage: null,
        }),
      ]),
    ).toBeNull();
  });
});

describe("resolveSidebarHeadRefresh", () => {
  it("does nothing when the current head still matches the latest head", () => {
    expect(
      resolveSidebarHeadRefresh({
        currentItems: [
          buildSandboxInstanceListItem({ id: "sbi_head" }),
          buildSandboxInstanceListItem({ id: "sbi_existing" }),
        ],
        latestHeadItems: [
          buildSandboxInstanceListItem({ id: "sbi_head" }),
          buildSandboxInstanceListItem({ id: "sbi_existing" }),
        ],
        maxAutoMergeCount: 10,
      }),
    ).toStrictEqual({
      kind: "noop",
    });
  });

  it("merges a small number of newer head items into the loaded list", () => {
    expect(
      resolveSidebarHeadRefresh({
        currentItems: [
          buildSandboxInstanceListItem({ id: "sbi_head" }),
          buildSandboxInstanceListItem({ id: "sbi_existing_2" }),
          buildSandboxInstanceListItem({ id: "sbi_existing_3" }),
        ],
        latestHeadItems: [
          buildSandboxInstanceListItem({ id: "sbi_new_1" }),
          buildSandboxInstanceListItem({ id: "sbi_new_2" }),
          buildSandboxInstanceListItem({ id: "sbi_head" }),
          buildSandboxInstanceListItem({ id: "sbi_existing_2" }),
        ],
        maxAutoMergeCount: 10,
      }),
    ).toStrictEqual({
      kind: "merge",
      newerItemCount: 2,
      items: [
        buildSandboxInstanceListItem({ id: "sbi_new_1" }),
        buildSandboxInstanceListItem({ id: "sbi_new_2" }),
        buildSandboxInstanceListItem({ id: "sbi_head" }),
        buildSandboxInstanceListItem({ id: "sbi_existing_2" }),
        buildSandboxInstanceListItem({ id: "sbi_existing_3" }),
      ],
    });
  });

  it("requires a hard refresh when the unseen newer set exceeds the merge threshold", () => {
    expect(
      resolveSidebarHeadRefresh({
        currentItems: [
          buildSandboxInstanceListItem({ id: "sbi_head" }),
          buildSandboxInstanceListItem({ id: "sbi_existing_2" }),
        ],
        latestHeadItems: [
          buildSandboxInstanceListItem({ id: "sbi_new_1" }),
          buildSandboxInstanceListItem({ id: "sbi_new_2" }),
          buildSandboxInstanceListItem({ id: "sbi_new_3" }),
          buildSandboxInstanceListItem({ id: "sbi_head" }),
        ],
        maxAutoMergeCount: 2,
      }),
    ).toStrictEqual({
      kind: "refresh",
      newerItemCount: 3,
    });
  });

  it("requires a hard refresh when the current head is missing from the fetched head page", () => {
    expect(
      resolveSidebarHeadRefresh({
        currentItems: [
          buildSandboxInstanceListItem({ id: "sbi_head" }),
          buildSandboxInstanceListItem({ id: "sbi_existing_2" }),
        ],
        latestHeadItems: [
          buildSandboxInstanceListItem({ id: "sbi_new_1" }),
          buildSandboxInstanceListItem({ id: "sbi_new_2" }),
          buildSandboxInstanceListItem({ id: "sbi_new_3" }),
        ],
        maxAutoMergeCount: 10,
      }),
    ).toStrictEqual({
      kind: "refresh",
      newerItemCount: 3,
    });
  });
});
