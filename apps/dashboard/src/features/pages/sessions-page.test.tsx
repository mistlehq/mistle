// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import {
  buildOptimisticSessions,
  resolveSessionResultsSummary,
  SandboxSessionStatusBadge,
  SessionsPage,
  shouldUseResumeActionLabel,
  shouldClearSelectedProfile,
} from "./sessions-page.js";

describe("SessionsPage", () => {
  it("uses the authenticated user's display name for optimistic sessions", () => {
    const optimisticSessions = buildOptimisticSessions({
      launchedSessions: [
        {
          profileId: "sbp_profile_alpha",
          profileDisplayName: "Alpha Profile",
          profileVersion: 3,
          sandboxInstanceId: "sbi_optimistic",
          createdAtIso: "2026-03-10T00:00:00.000Z",
          status: "starting",
          failureCode: null,
          failureMessage: null,
        },
      ],
      listedItems: [],
      currentUserId: "user-id",
      currentUserDisplayName: "Mistle User",
    });

    expect(optimisticSessions).toStrictEqual([
      {
        id: "sbi_optimistic",
        sandboxProfileId: "sbp_profile_alpha",
        sandboxProfileDisplayName: "Alpha Profile",
        sandboxProfileVersion: 3,
        status: "starting",
        startedBy: {
          kind: "user",
          id: "user-id",
          name: "Mistle User",
        },
        source: "dashboard",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
        failureCode: null,
        failureMessage: null,
      },
    ]);
  });

  it("renders sandbox launcher controls", async () => {
    const queryClient = createTestQueryClient();
    seedAuthenticatedSession(queryClient);

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    try {
      expect(screen.getByText("Start a new session")).toBeDefined();
      expect(screen.getByRole("combobox", { name: "Sandbox profile" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
      expect(screen.queryByText("Recent Sessions")).toBeNull();
      expect(screen.queryByText("No launched sessions yet.")).toBeNull();
    } finally {
      rendered.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    }
  });

  it("uses the shared dashboard table styling for the session list", () => {
    const queryClient = createTestQueryClient();
    seedAuthenticatedSession(queryClient);

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-slot="table" class="w-full caption-bottom text-sm table-fixed"');
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-xs font-semibold tracking-wide uppercase");
    expect(markup).toContain('<span class="sr-only">Actions</span>');
  });

  it("renders the result summary even when there is only one page", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedAuthenticatedSession(queryClient);
    queryClient.setQueryData(
      sandboxInstancesListQueryKey({
        limit: 20,
        after: null,
        before: null,
      }),
      {
        items: [
          {
            id: "sbi_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileDisplayName: "Profile 123",
            sandboxProfileVersion: 2,
            status: "running",
            startedBy: {
              kind: "user",
              id: "user-id",
              name: "Mistle User",
            },
            source: "dashboard",
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            failureCode: null,
            failureMessage: null,
          },
        ],
        nextPage: null,
        previousPage: null,
        totalResults: 1,
      },
    );

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Showing 1 of 1");
    expect(markup).not.toContain(">Previous<");
    expect(markup).not.toContain(">Next<");
  });

  it("counts optimistic sessions only in the visible results", () => {
    expect(
      resolveSessionResultsSummary({
        listedSessionCount: 1,
        totalResults: 1,
        optimisticSessionCount: 1,
      }),
    ).toStrictEqual({
      visibleCount: 2,
      totalCount: 2,
    });
  });

  it("counts optimistic sessions in the total on short pages", () => {
    expect(
      resolveSessionResultsSummary({
        listedSessionCount: 1,
        totalResults: 21,
        optimisticSessionCount: 1,
      }),
    ).toStrictEqual({
      visibleCount: 2,
      totalCount: 22,
    });
  });

  it("renders a compact failure indicator with tooltip details", () => {
    const markup = renderToStaticMarkup(
      <SandboxSessionStatusBadge
        status="failed"
        failureCode="INSTANCE_VOLUME_PROVISION_FAILED"
        failureMessage="Failed to provision instance volume before runtime startup."
      />,
    );

    expect(markup).toContain("View failure details");
    expect(markup).toContain("Failed");
    expect(markup).toContain("INSTANCE_VOLUME_PROVISION_FAILED");
    expect(markup).toContain("Failed to provision instance volume before runtime startup.");
    expect(markup).not.toContain("text-destructive whitespace-pre-wrap text-xs");
  });

  it("routes stopped sessions into the workbench route directly", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedAuthenticatedSession(queryClient);
    queryClient.setQueryData(
      sandboxInstancesListQueryKey({
        limit: 20,
        after: null,
        before: null,
      }),
      {
        items: [
          {
            id: "sbi_stopped",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: 2,
            status: "stopped",
            startedBy: {
              kind: "user",
              id: "user-id",
              name: "Mistle User",
            },
            source: "dashboard",
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            failureCode: null,
            failureMessage: null,
          },
        ],
        nextPage: null,
        previousPage: null,
        totalResults: 1,
      },
    );

    function SessionRouteProbe(): React.JSX.Element {
      const location = useLocation();
      return (
        <div>
          <span>{location.pathname}</span>
        </div>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/sessions"]}>
          <Routes>
            <Route element={<SessionsPage />} path="/sessions" />
            <Route element={<SessionRouteProbe />} path="/sessions/:sandboxInstanceId" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    expect(screen.getByText("/sessions/sbi_stopped")).toBeDefined();
  });

  it("uses the resume action label only for stopped sessions", () => {
    expect(shouldUseResumeActionLabel("stopped")).toBe(true);
    expect(shouldUseResumeActionLabel("starting")).toBe(false);
    expect(shouldUseResumeActionLabel("running")).toBe(false);
    expect(shouldUseResumeActionLabel("failed")).toBe(false);
  });

  it("clears a stale selected profile after launchable profiles finish refetching without it", () => {
    expect(
      shouldClearSelectedProfile({
        selectedProfile: {
          id: "sbp_profile_alpha",
          displayName: "Alpha Profile",
          status: "active",
          latestVersion: 3,
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-10T00:00:00.000Z",
          organizationId: "org_123",
        },
        selectableProfiles: [],
        isSelectableProfilesPending: false,
      }),
    ).toBe(true);
  });

  it("keeps the current selection while launchable profiles are still loading", () => {
    expect(
      shouldClearSelectedProfile({
        selectedProfile: {
          id: "sbp_profile_alpha",
          displayName: "Alpha Profile",
          status: "active",
          latestVersion: 3,
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-10T00:00:00.000Z",
          organizationId: "org_123",
        },
        selectableProfiles: [],
        isSelectableProfilesPending: true,
      }),
    ).toBe(false);
  });

  it("keeps the current selection when the selected profile is still launchable", () => {
    expect(
      shouldClearSelectedProfile({
        selectedProfile: {
          id: "sbp_profile_alpha",
          displayName: "Alpha Profile",
          status: "active",
          latestVersion: 3,
          createdAt: "2026-03-10T00:00:00.000Z",
          updatedAt: "2026-03-10T00:00:00.000Z",
          organizationId: "org_123",
        },
        selectableProfiles: [
          {
            id: "sbp_profile_alpha",
            displayName: "Alpha Profile",
            status: "active",
            latestVersion: 3,
            createdAt: "2026-03-10T00:00:00.000Z",
            updatedAt: "2026-03-10T00:00:00.000Z",
            organizationId: "org_123",
          },
        ],
        isSelectableProfilesPending: false,
      }),
    ).toBe(false);
  });
});
