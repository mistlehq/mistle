// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import {
  buildOptimisticSessions,
  resolveSessionResultsSummary,
  SandboxSessionStatusBadge,
  SessionsPage,
  shouldClearSelectedProfile,
  shouldUseResumeActionLabel,
} from "./sessions-page.js";
import { buildSandboxInstanceListItemFixture } from "./sessions-page.story-fixtures.js";

type SelectableProfile = {
  id: string;
  displayName: string;
  status: "active";
  latestVersion: number;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
};

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
  items: SandboxInstanceListItem[];
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
        title: null,
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

    expect(markup).toContain(
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[48rem]"',
    );
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-xs font-semibold tracking-wide uppercase");
    expect(markup).toContain('<span class="sr-only">Actions</span>');
  });

  it("keeps a single horizontally scrollable table layout", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_mobile",
          sandboxProfileDisplayName: "Finance Investigator",
          status: "failed",
          failureCode: "sandbox_bootstrap_failed",
          failureMessage: "Could not start sandbox runtime because image pull failed.",
        }),
      ],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-slot="table-container" class="relative w-full overflow-x-auto"');
    expect(markup).toContain(
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[48rem]"',
    );
    expect(markup).toContain("Finance Investigator");
    expect(markup).not.toContain('class="grid gap-3 md:hidden"');
    expect(markup).not.toContain('class="hidden md:block"');
  });

  it("renders the seeded session without pagination when there is only one page", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_123",
          title: "Single session",
          sandboxProfileDisplayName: "Profile metadata",
        }),
      ],
      totalResults: 1,
    });

    renderSessionsPage({
      queryClient,
    });

    expect(screen.getByText("Single session")).toBeDefined();
    expect(screen.getByText("Profile metadata")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("renders Untitled when the persisted conversation title is missing", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_untitled", title: null })],
    });

    renderSessionsPage({
      queryClient,
    });

    expect(screen.getByText("Untitled")).toBeDefined();
    expect(screen.getByText("Alpha Profile")).toBeDefined();
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
    expect(markup).toContain("Failed");
    expect(markup).not.toContain("sandbox_start_failed");
    expect(markup).not.toContain("Failed to start sandbox runtime.");
    expect(markup).not.toContain("text-destructive whitespace-pre-wrap text-xs");
  });

  it("uses the same badge labels as the workbench header mapper", () => {
    expect(resolveSandboxStatusBadgeUi(null).label).toBe("Loading status");
    expect(resolveSandboxStatusBadgeUi("pending").label).toBe("Pending");
    expect(resolveSandboxStatusBadgeUi("starting").label).toBe("Starting");
    expect(resolveSandboxStatusBadgeUi("running").label).toBe("Running");
    expect(resolveSandboxStatusBadgeUi("stopped").label).toBe("Stopped");
    expect(resolveSandboxStatusBadgeUi("failed").label).toBe("Failed");
  });

  it("routes stopped sessions into the workbench route directly", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_stopped", status: "stopped" })],
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

  it("uses the open action label for non-stopped sessions", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_running", status: "running" })],
    });

    const rendered = renderSessionsPage({
      queryClient,
    });

    expect(within(rendered.container).getByRole("button", { name: "Open" })).toBeDefined();
  });

  it("uses the resume action label only for stopped sessions", () => {
    expect(shouldUseResumeActionLabel("stopped")).toBe(true);
    expect(shouldUseResumeActionLabel("starting")).toBe(false);
    expect(shouldUseResumeActionLabel("running")).toBe(false);
    expect(shouldUseResumeActionLabel("failed")).toBe(false);
  });

  it("renders automation names in the started by column without the source sublabel", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_automation",
          startedBy: {
            kind: "system",
            id: "aru_automation",
            name: "GitHub Repo Triage",
          },
          source: "webhook",
        }),
      ],
    });

    const rendered = renderSessionsPage({
      queryClient,
    });

    expect(within(rendered.container).getByText("GitHub Repo Triage")).toBeDefined();
    expect(within(rendered.container).queryByText("dashboard")).toBeNull();
    expect(within(rendered.container).queryByText("webhook")).toBeNull();
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
