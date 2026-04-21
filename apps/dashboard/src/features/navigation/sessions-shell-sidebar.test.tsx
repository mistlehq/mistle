import { describe, expect, it } from "vitest";

import type { SessionSidebarGroup } from "../sessions/sessions-types.js";
import {
  buildSessionsShellSidebarItems,
  resolveNextSessionsShellSidebarRequestedLimit,
  resolveSessionsShellSidebarRequestedLimitAfterError,
  resolveSessionsShellSidebarHasMore,
  shouldResolveSessionsShellSidebarLimit,
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
      {
        id: "sbi_failed",
        label: "Untitled",
        profileName: "Broken",
        metadataLabel: "Failed",
        to: "/sessions/sbi_failed",
        showActivityIndicator: false,
        updatedAt: "2026-04-08T00:00:00.000Z",
      },
    ]);
  });
});

describe("resolveSessionsShellSidebarHasMore", () => {
  it("keeps loading while the fetched item count still fills the requested limit", () => {
    expect(
      resolveSessionsShellSidebarHasMore({
        itemCount: 25,
        resolvedLimit: 25,
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

describe("shouldResolveSessionsShellSidebarLimit", () => {
  it("promotes the resolved limit only after a non-placeholder success", () => {
    expect(
      shouldResolveSessionsShellSidebarLimit({
        isSuccess: true,
        isPlaceholderData: false,
      }),
    ).toBe(true);
  });

  it("does not promote the resolved limit while placeholder data is shown", () => {
    expect(
      shouldResolveSessionsShellSidebarLimit({
        isSuccess: true,
        isPlaceholderData: true,
      }),
    ).toBe(false);
  });
});

describe("resolveSessionsShellSidebarRequestedLimitAfterError", () => {
  it("rolls the requested limit back to the last successful limit after a load-more error", () => {
    expect(
      resolveSessionsShellSidebarRequestedLimitAfterError({
        requestedLimit: 50,
        resolvedLimit: 25,
        isError: true,
        isFetching: false,
      }),
    ).toBe(25);
  });

  it("keeps the current request when no load-more error occurred", () => {
    expect(
      resolveSessionsShellSidebarRequestedLimitAfterError({
        requestedLimit: 50,
        resolvedLimit: 25,
        isError: false,
        isFetching: false,
      }),
    ).toBeNull();
    expect(
      resolveSessionsShellSidebarRequestedLimitAfterError({
        requestedLimit: 50,
        resolvedLimit: 25,
        isError: true,
        isFetching: true,
      }),
    ).toBeNull();
    expect(
      resolveSessionsShellSidebarRequestedLimitAfterError({
        requestedLimit: 25,
        resolvedLimit: 25,
        isError: true,
        isFetching: false,
      }),
    ).toBeNull();
  });
});

describe("resolveNextSessionsShellSidebarRequestedLimit", () => {
  it("loads older sessions in 25-item steps", () => {
    expect(
      resolveNextSessionsShellSidebarRequestedLimit({
        currentLimit: 25,
      }),
    ).toBe(50);
  });

  it("clamps the final request to the 100-item API cap", () => {
    expect(
      resolveNextSessionsShellSidebarRequestedLimit({
        currentLimit: 75,
      }),
    ).toBe(100);
    expect(
      resolveNextSessionsShellSidebarRequestedLimit({
        currentLimit: 100,
      }),
    ).toBe(100);
  });
});
