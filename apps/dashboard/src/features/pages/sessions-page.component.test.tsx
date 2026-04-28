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
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import {
  buildOptimisticSessions,
  resolveSessionResultsSummary,
  SessionsPage,
  shouldClearSelectedProfile,
} from "./sessions-page.js";
import { buildSandboxInstanceListItemFixture } from "./sessions-page.story-fixtures.js";

type SelectableProfile = {
  activeVersion: number | null;
  id: string;
  displayName: string;
  status: "active";
  latestVersion: number;
  repositoryOptions: [];
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
    activeVersion: 3,
    displayName: "Alpha Profile",
    status: "active",
    latestVersion: 3,
    repositoryOptions: [],
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
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[40rem] table-fixed"',
    );
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-[11px] font-semibold tracking-[0.08em] uppercase");
    expect(markup).toContain(">Sessions<");
    expect(markup).toContain(">Sandbox profile<");
    expect(markup).toContain(">Created<");
    expect(markup).toContain(">Updated<");
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
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[40rem] table-fixed"',
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

  it("truncates long session titles in the list so the full value can be shown in a tooltip", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_long_title",
          title:
            "This session title is intentionally extremely long so the sessions list keeps the row compact instead of wrapping across multiple lines",
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

    expect(markup).toContain("This session title is intentionally extremely long");
    expect(markup).toContain('class="min-w-0 flex-1"');
    expect(markup).toContain('class="block truncate cursor-default font-medium');
    expect(markup).toContain(
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[40rem] table-fixed"',
    );
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
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_failed",
          status: "failed",
          failureCode: "sandbox_start_failed",
          failureMessage: "Failed to start sandbox runtime.",
        }),
      ],
    });

    const rendered = renderSessionsPage({
      queryClient,
    });

    expect(within(rendered.container).getByLabelText("View failure details")).toBeDefined();
    expect(within(rendered.container).getByText("Failed")).toBeDefined();
    expect(rendered.container.innerHTML).not.toContain("sandbox_start_failed");
    expect(rendered.container.innerHTML).not.toContain("Failed to start sandbox runtime.");
    expect(rendered.container.innerHTML).not.toContain(
      "text-destructive whitespace-pre-wrap text-xs",
    );
  });

  it("uses the same badge labels as the workbench header mapper", () => {
    expect(resolveSandboxStatusBadgeUi(null).label).toBe("Loading status");
    expect(resolveSandboxStatusBadgeUi("pending").label).toBe("Pending");
    expect(resolveSandboxStatusBadgeUi("starting").label).toBe("Starting");
    expect(resolveSandboxStatusBadgeUi("running").label).toBe("Running");
    expect(resolveSandboxStatusBadgeUi("stopped").label).toBe("Stopped");
    expect(resolveSandboxStatusBadgeUi("failed").label).toBe("Failed");
  });

  it("routes stopped sessions into the workbench route directly from the row", () => {
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

    fireEvent.click(screen.getByRole("link", { name: /untitled/i }));

    expect(screen.getByText("/sessions/sbi_stopped")).toBeDefined();
  });

  it("marks running rows as navigable links", () => {
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

    expect(within(rendered.container).getByRole("link").getAttribute("href")).toBe(
      "/sessions/sbi_running",
    );
  });

  it("renders failed sessions as non-navigable rows", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_failed",
          status: "failed",
          failureCode: "sandbox_bootstrap_failed",
          failureMessage: "Could not start sandbox runtime because image pull failed.",
        }),
      ],
    });

    const rendered = renderSessionsPage({
      queryClient,
    });

    expect(within(rendered.container).queryByRole("link")).toBeNull();
    expect(rendered.container.querySelector('tr[aria-disabled="true"]')).not.toBeNull();
    expect(rendered.container.innerHTML).toContain("hover:bg-transparent");
  });

  it("shows compact created and updated labels for non-failed sessions", () => {
    const updatedAt = "2026-03-08T00:00:00.000Z";
    const createdAt = "2026-03-07T00:00:00.000Z";
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_updated",
          createdAt,
          updatedAt,
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

    expect(markup).toContain(`>${formatCompactRelativeOrDate(createdAt)}<`);
    expect(markup).toContain(`>${formatCompactRelativeOrDate(updatedAt)}<`);
  });

  it("shows the failed badge in place of the updated label for failed sessions", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_failed",
          status: "failed",
          failureCode: "sandbox_bootstrap_failed",
          failureMessage: "Could not start sandbox runtime because image pull failed.",
        }),
      ],
    });

    const rendered = renderSessionsPage({
      queryClient,
    });

    expect(within(rendered.container).getByText("Failed")).toBeDefined();
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
