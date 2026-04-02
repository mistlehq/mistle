// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import {
  buildOptimisticSessions,
  resolveSessionResultsSummary,
  SandboxSessionStatusBadge,
  SessionsPage,
  shouldClearSelectedProfile,
  shouldUseResumeActionLabel,
} from "./sessions-page.js";

type SessionListItem = {
  id: string;
  sandboxProfileId: string;
  sandboxProfileDisplayName?: string;
  sandboxProfileVersion: number;
  status: "starting" | "running" | "stopped" | "failed";
  startedBy: {
    kind: "user";
    id: string;
    name: string;
  };
  source: "dashboard";
  createdAt: string;
  updatedAt: string;
  failureCode: string | null;
  failureMessage: string | null;
};

type SelectableProfile = {
  id: string;
  displayName: string;
  status: "active";
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
};

function buildListedSession(
  overrides: Partial<SessionListItem> & Pick<SessionListItem, "id">,
): SessionListItem {
  const { id, ...restOverrides } = overrides;

  return {
    id,
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
    ...restOverrides,
  };
}

function buildSelectableProfile(
  overrides: Partial<SelectableProfile> & Pick<SelectableProfile, "id">,
): SelectableProfile {
  const { id, ...restOverrides } = overrides;

  return {
    id,
    displayName: "Alpha Profile",
    status: "active",
    latestVersion: 3,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    organizationId: "org_123",
    ...restOverrides,
  };
}

function createSessionsPageQueryClient(
  input?: Parameters<typeof createTestQueryClient>[0],
): ReturnType<typeof createTestQueryClient> {
  const queryClient = createTestQueryClient(input);
  seedAuthenticatedSession(queryClient);
  return queryClient;
}

function seedSessionsList(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
  items: SessionListItem[];
  totalResults?: number;
}): void {
  input.queryClient.setQueryData(
    sandboxInstancesListQueryKey({
      limit: 20,
      after: null,
      before: null,
    }),
    {
      items: input.items,
      nextPage: null,
      previousPage: null,
      totalResults: input.totalResults ?? input.items.length,
    },
  );
}

function renderSessionsPage(input?: {
  queryClient?: ReturnType<typeof createTestQueryClient>;
  initialEntries?: string[];
  routes?: React.ReactNode;
}) {
  const queryClient = input?.queryClient ?? createSessionsPageQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        {...(input?.initialEntries === undefined ? {} : { initialEntries: input.initialEntries })}
      >
        {input?.routes ?? <SessionsPage />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
    const queryClient = createSessionsPageQueryClient();

    const rendered = renderSessionsPage({ queryClient });

    try {
      expect(screen.getByRole("combobox", { name: "Sandbox profile" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Start session" })).toBeDefined();
    } finally {
      rendered.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    }
  });

  it("uses the shared dashboard table styling for the session list", () => {
    const queryClient = createSessionsPageQueryClient();

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

  it("renders the seeded session without pagination when there is only one page", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildListedSession({ id: "sbi_123", sandboxProfileDisplayName: "Single session" })],
      totalResults: 1,
    });

    renderSessionsPage({
      queryClient,
    });

    expect(screen.getByText("Single session")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
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
        failureCode="sandbox_start_failed"
        failureMessage="Failed to start sandbox runtime."
      />,
    );

    expect(markup).toContain("View failure details");
    expect(markup).toContain("Sandbox failed");
    expect(markup).not.toContain("sandbox_start_failed");
    expect(markup).not.toContain("Failed to start sandbox runtime.");
    expect(markup).not.toContain("text-destructive whitespace-pre-wrap text-xs");
  });

  it("uses the same badge labels as the workbench header mapper", () => {
    expect(resolveSandboxStatusBadgeUi("pending").label).toBe("Starting sandbox");
    expect(resolveSandboxStatusBadgeUi("starting").label).toBe("Starting sandbox");
    expect(resolveSandboxStatusBadgeUi("running").label).toBe("Connected");
    expect(resolveSandboxStatusBadgeUi("stopped").label).toBe("Sandbox stopped");
    expect(resolveSandboxStatusBadgeUi("failed").label).toBe("Sandbox failed");
  });

  it("routes stopped sessions into the workbench route directly", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildListedSession({ id: "sbi_stopped", status: "stopped" })],
    });

    function SessionRouteProbe(): React.JSX.Element {
      const location = useLocation();
      return (
        <div>
          <span>{location.pathname}</span>
        </div>
      );
    }

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions"],
      routes: (
        <Routes>
          <Route element={<SessionsPage />} path="/sessions" />
          <Route element={<SessionRouteProbe />} path="/sessions/:sandboxInstanceId" />
        </Routes>
      ),
    });

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
        selectedProfile: buildSelectableProfile({
          id: "sbp_profile_alpha",
        }),
        selectableProfiles: [],
        isSelectableProfilesPending: false,
      }),
    ).toBe(true);
  });

  it("keeps the current selection while launchable profiles are still loading", () => {
    expect(
      shouldClearSelectedProfile({
        selectedProfile: buildSelectableProfile({
          id: "sbp_profile_alpha",
        }),
        selectableProfiles: [],
        isSelectableProfilesPending: true,
      }),
    ).toBe(false);
  });

  it("keeps the current selection when the selected profile is still launchable", () => {
    expect(
      shouldClearSelectedProfile({
        selectedProfile: buildSelectableProfile({
          id: "sbp_profile_alpha",
        }),
        selectableProfiles: [
          buildSelectableProfile({
            id: "sbp_profile_alpha",
          }),
        ],
        isSelectableProfilesPending: false,
      }),
    ).toBe(false);
  });
});
