import { describe, expect, it } from "vitest";

import type {
  SandboxInstanceListItem,
  SandboxInstancesListResult,
} from "../sessions/sessions-types.js";
import {
  buildSidebarSessionItems,
  buildSidebarSessionNavItems,
  flattenSidebarSessionPages,
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
      {
        id: "sbi_older",
        label: "Older created session",
        profileName: "Docs",
        metadataLabel: "Failed",
        to: "/sessions/sbi_older",
        showActivityIndicator: false,
        updatedAt: "2026-04-09T00:00:00.000Z",
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
