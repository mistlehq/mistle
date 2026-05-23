// @vitest-environment jsdom

import { systemSleeper } from "@mistle/time";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { describe, expect, it } from "vitest";

import { seedAuthenticatedSession } from "../../test-support/auth-session.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import { launchableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { LaunchableSandboxProfilesResult } from "../sandbox-profiles/sandbox-profiles-types.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import type {
  SandboxInstanceListItem,
  SandboxInstancesNextPageCursor,
} from "../sessions/sessions-types.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import { NoLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import { PageHeaderSidebarTriggerProvider } from "../shared/page-header-sidebar-trigger-context.js";
import { SessionsRoutes } from "../shell/app-shell-sessions-sidebar-mode.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import type { TriggerListItem, TriggersListResult } from "../triggers/triggers-types.js";
import { resolveSandboxStatusBadgeUi } from "./sandbox-status-presentation.js";
import { SessionsPage } from "./sessions-page.js";
import {
  buildSandboxInstanceListItemFixture,
  buildStoryLaunchableSandboxProfile,
} from "./sessions-page.story-fixtures.js";

function createSessionsPageQueryClient(
  input?: Parameters<typeof createTestQueryClient>[0],
): ReturnType<typeof createTestQueryClient> {
  const queryClient = createTestQueryClient(input);
  seedAuthenticatedSession(queryClient);
  queryClient.setQueryData(
    triggersListQueryKey({
      limit: 100,
      after: null,
      before: null,
    }),
    {
      items: [],
      nextPage: null,
      previousPage: null,
      totalResults: 0,
    } satisfies TriggersListResult,
  );
  return queryClient;
}

function seedSessionsList(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
  items: SandboxInstanceListItem[];
  totalResults?: number;
  after?: string | null;
  before?: string | null;
  nextPage?: SandboxInstancesNextPageCursor | null;
  filters?: {
    search: string;
    owner: "anyone" | "me";
    startedFrom: "any" | "manual" | "trigger" | "event" | "schedule";
    triggerId: string | null;
  };
}): void {
  input.queryClient.setQueryData(
    sandboxInstancesListQueryKey({
      limit: 20,
      after: input.after ?? null,
      before: input.before ?? null,
      search: input.filters?.search ?? "",
      owner: input.filters?.owner ?? "anyone",
      startedFrom: input.filters?.startedFrom ?? "any",
      triggerId: input.filters?.triggerId ?? null,
    }),
    {
      items: input.items,
      nextPage: input.nextPage ?? null,
      previousPage: null,
      totalResults: input.totalResults ?? input.items.length,
    },
  );
}

function seedLaunchableSandboxProfiles(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
  items: LaunchableSandboxProfilesResult["items"];
}): void {
  input.queryClient.setQueryData(launchableSandboxProfilesQueryKey(), {
    items: input.items,
  } satisfies LaunchableSandboxProfilesResult);
}

function seedSessionFilterTriggers(input: {
  queryClient: ReturnType<typeof createTestQueryClient>;
  items: TriggerListItem[];
}): void {
  input.queryClient.setQueryData(
    triggersListQueryKey({
      limit: 100,
      after: null,
      before: null,
    }),
    {
      items: input.items,
      nextPage: null,
      previousPage: null,
      totalResults: input.items.length,
    } satisfies TriggersListResult,
  );
}

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <span data-testid="location-search">{location.search}</span>
      <span data-testid="navigation-type">{navigationType}</span>
    </>
  );
}

function OwnerFilterProbe(): React.JSX.Element {
  const [, setSearchParams] = useSearchParams();
  return (
    <button
      onClick={() => {
        setSearchParams(new URLSearchParams("limit=20&owner=me"), { replace: true });
      }}
      type="button"
    >
      Apply owner filter
    </button>
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
  it("routes new session creation through the dedicated new session page", async () => {
    const queryClient = createSessionsPageQueryClient();

    function NewSessionRouteProbe(): React.JSX.Element {
      const location = useLocation();
      return <span>{location.pathname}</span>;
    }

    const rendered = renderSessionsPage({
      queryClient,
      initialEntries: [SessionsRoutes.INDEX],
      routes: (
        <Routes>
          <Route element={<SessionsPage />} path={SessionsRoutes.INDEX} />
          <Route element={<NewSessionRouteProbe />} path={SessionsRoutes.NEW} />
        </Routes>
      ),
    });

    try {
      expect(screen.queryByRole("combobox", { name: "Sandbox profile" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start session" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "New session" }));

      expect(screen.getByText(SessionsRoutes.NEW)).toBeDefined();
    } finally {
      rendered.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    }
  });

  it("uses the shared dashboard table styling for the session list", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_table_style" })],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain(
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[44rem] table-fixed"',
    );
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-[11px] font-semibold tracking-[0.08em] uppercase");
    expect(markup).toContain(">Sessions<");
    expect(markup).toContain(">Sandbox profile<");
    expect(markup).toContain(">Created<");
    expect(markup).toContain(">Updated<");
  });

  it("shows the delete row action without a confirmation dialog", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_direct_delete",
          title: "Clean up old branch",
        }),
      ],
    });

    renderSessionsPage({
      queryClient,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Session actions for Clean up old branch",
      }),
    );
    expect(screen.getByRole("menuitem", { name: "Delete session" })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Delete session?" })).toBeNull();
  });

  it("guides users to publish a sandbox profile when no sessions can be started yet", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [],
      totalResults: 0,
    });
    seedLaunchableSandboxProfiles({
      queryClient,
      items: [],
    });

    renderSessionsPage({
      queryClient,
    });

    expect(
      screen.getByRole("heading", { name: "Publish a sandbox profile to start sessions" }),
    ).toBeDefined();
    const headerNewSessionButton = screen.getByRole("button", { name: "New session" });
    expect(headerNewSessionButton.hasAttribute("disabled")).toBe(true);
    expect(headerNewSessionButton.getAttribute("title")).toBe(
      "Publish a sandbox profile before starting a session.",
    );
    expect(screen.getByRole("button", { name: "Open sandbox profiles" }).getAttribute("href")).toBe(
      "/sandbox-profiles",
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("guides users to start a session when a launchable sandbox profile exists", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [],
      totalResults: 0,
    });
    seedLaunchableSandboxProfiles({
      queryClient,
      items: [buildStoryLaunchableSandboxProfile({ id: "sbp_launchable" })],
    });

    renderSessionsPage({
      queryClient,
    });

    expect(screen.getByRole("heading", { name: "Start your first session" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "New session" })).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the shell sidebar trigger in the sessions page header", async () => {
    const queryClient = createSessionsPageQueryClient();
    const rendered = renderSessionsPage({
      queryClient,
      routes: (
        <PageHeaderSidebarTriggerProvider
          value={{
            control: <button type="button">Toggle Sidebar</button>,
            isVisible: true,
          }}
        >
          <SessionsPage />
        </PageHeaderSidebarTriggerProvider>
      ),
    });

    try {
      const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
      const heading = screen.getByRole("heading", { name: "Sessions" });

      expect(trigger.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    } finally {
      rendered.unmount();
      await queryClient.cancelQueries();
      queryClient.clear();
    }
  });

  it("shows filtered no-results separately from the first-use empty state", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [],
      totalResults: 0,
      filters: {
        search: "PlanetScale",
        owner: "me",
        startedFrom: "trigger",
        triggerId: null,
      },
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions?search=PlanetScale&owner=me&startedFrom=trigger"],
    });

    expect(screen.getByRole("textbox", { name: "Search sessions" }).getAttribute("value")).toBe(
      "PlanetScale",
    );
    expect(screen.getByText("No sessions match these filters.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Start your first session" })).toBeNull();
  });

  it("debounces session search changes before storing them in the URL and clearing pagination cursors", async () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_filter_url" })],
      after: "cursor_1",
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions?after=cursor_1"],
      routes: (
        <>
          <SessionsPage />
          <LocationProbe />
        </>
      ),
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Slack" },
    });

    expect(screen.getByRole("textbox", { name: "Search sessions" }).getAttribute("value")).toBe(
      "Slack",
    );
    expect(screen.getByTestId("location-search").textContent).toBe("?after=cursor_1");

    await systemSleeper.sleep(150);

    expect(screen.getByTestId("location-search").textContent).toBe("?after=cursor_1");

    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toBe("?limit=20&search=Slack");
      expect(screen.getByTestId("navigation-type").textContent).toBe("REPLACE");
      expect(
        queryClient.getQueryState(
          sandboxInstancesListQueryKey({
            limit: 20,
            after: null,
            before: null,
            search: "Slack",
            owner: "anyone",
            startedFrom: "any",
            triggerId: null,
          }),
        ),
      ).toBeDefined();
    });
  });

  it("keeps the current sessions list mounted while a search result request is pending", async () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_existing_session",
          title: "Existing session",
        }),
      ],
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions"],
      routes: (
        <>
          <SessionsPage />
          <LocationProbe />
        </>
      ),
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Slack" },
    });

    expect(screen.getByRole("textbox", { name: "Search sessions" }).getAttribute("value")).toBe(
      "Slack",
    );
    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toBe("?limit=20&search=Slack");
    });
    expect(screen.getByText("Existing session")).toBeDefined();
  });

  it("cancels a pending debounced search when filters are cleared", async () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_clear_pending_search" })],
      filters: {
        search: "PlanetScale",
        owner: "me",
        startedFrom: "any",
        triggerId: null,
      },
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions?search=PlanetScale&owner=me"],
      routes: (
        <>
          <SessionsPage />
          <LocationProbe />
        </>
      ),
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Slack" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(screen.getByRole("textbox", { name: "Search sessions" }).getAttribute("value")).toBe("");
    expect(screen.getByTestId("location-search").textContent).toBe("?limit=20");

    await systemSleeper.sleep(350);

    expect(screen.getByTestId("location-search").textContent).toBe("?limit=20");
    expect(
      queryClient.getQueryState(
        sandboxInstancesListQueryKey({
          limit: 20,
          after: null,
          before: null,
          search: "Slack",
          owner: "me",
          startedFrom: "any",
          triggerId: null,
        }),
      ),
    ).toBeUndefined();
  });

  it("cancels a pending debounced search when another filter changes", async () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_cancel_search_on_owner_filter" })],
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions"],
      routes: (
        <>
          <SessionsPage />
          <LocationProbe />
          <OwnerFilterProbe />
        </>
      ),
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Slack" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply owner filter" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Search sessions" }).getAttribute("value")).toBe(
        "",
      );
      expect(screen.getByTestId("location-search").textContent).toBe("?limit=20&owner=me");
      expect(screen.getByTestId("navigation-type").textContent).toBe("REPLACE");
    });

    await systemSleeper.sleep(350);

    expect(screen.getByTestId("location-search").textContent).toBe("?limit=20&owner=me");
    expect(
      queryClient.getQueryState(
        sandboxInstancesListQueryKey({
          limit: 20,
          after: null,
          before: null,
          search: "Slack",
          owner: "me",
          startedFrom: "any",
          triggerId: null,
        }),
      ),
    ).toBeUndefined();
  });

  it("opts search result requests out of the shell top loading bar", async () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_shell_loader_existing_session",
          title: "Existing session",
        }),
      ],
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions"],
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Slack" },
    });

    expect(screen.getByText("Existing session")).toBeDefined();
    await waitFor(() => {
      const searchQuery = queryClient.getQueryCache().find({
        queryKey: sandboxInstancesListQueryKey({
          limit: 20,
          after: null,
          before: null,
          search: "Slack",
          owner: "anyone",
          startedFrom: "any",
          triggerId: null,
        }),
      });

      expect(searchQuery?.options.meta).toEqual(NoLoadingIndicatorMeta);
    });
  });

  it("uses push navigation for pagination", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_paginate_forward" })],
      nextPage: {
        after: "cursor_next_page",
        limit: 20,
      },
      totalResults: 40,
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions"],
      routes: (
        <>
          <SessionsPage />
          <LocationProbe />
        </>
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(screen.getByTestId("location-search").textContent).toBe(
      "?limit=20&after=cursor_next_page",
    );
    expect(screen.getByTestId("navigation-type").textContent).toBe("PUSH");
  });

  it("disables pagination while a normalized no-op search edit is debouncing", async () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_pending_trimmed_search" })],
      after: "cursor_from_slack_results",
      filters: {
        search: "Slack",
        owner: "anyone",
        startedFrom: "any",
        triggerId: null,
      },
      nextPage: {
        after: "cursor_from_slack_results",
        limit: 20,
      },
      totalResults: 40,
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions?search=Slack&after=cursor_from_slack_results"],
      routes: (
        <>
          <SessionsPage />
          <LocationProbe />
        </>
      ),
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Slack " },
    });

    const nextPage = screen.getByRole("button", { name: "Go to next page" });
    expect(nextPage.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(nextPage);
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?search=Slack&after=cursor_from_slack_results",
    );

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Search sessions" }).getAttribute("value")).toBe(
        "Slack",
      );
    });
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?search=Slack&after=cursor_from_slack_results",
    );
  });

  it("does not apply stale pagination cursors while a search result request is pending", async () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_paginated_before_search" })],
      nextPage: {
        after: "cursor_from_unfiltered_results",
        limit: 20,
      },
      totalResults: 40,
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions"],
      routes: (
        <>
          <SessionsPage />
          <LocationProbe />
        </>
      ),
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Search sessions" }), {
      target: { value: "Slack" },
    });

    const nextPage = screen.getByRole("button", { name: "Go to next page" });
    expect(nextPage.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(nextPage);
    expect(screen.getByTestId("location-search").textContent).toBe("");

    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toBe("?limit=20&search=Slack");
      expect(
        screen.getByRole("button", { name: "Go to next page" }).getAttribute("aria-disabled"),
      ).toBe("true");
    });

    fireEvent.click(nextPage);

    expect(screen.getByTestId("location-search").textContent).toBe("?limit=20&search=Slack");
  });

  it("offers specific triggers in the start source filter", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [buildSandboxInstanceListItemFixture({ id: "sbi_trigger_filter" })],
    });
    seedSessionFilterTriggers({
      queryClient,
      items: [
        {
          id: "atm_slack",
          kind: "webhook",
          name: "Slack app mention received",
          enabled: true,
          target: {
            sandboxProfileId: "sbp_profile_alpha",
            sandboxProfileName: "Alpha Profile",
            sandboxProfileVersion: 3,
            primaryRepositoryId: null,
            primaryRepositoryName: null,
          },
          source: {
            kind: "webhook",
            events: [{ label: "app_mention" }],
          },
          updatedAt: "2026-03-10T00:00:00.000Z",
        },
      ],
    });

    renderSessionsPage({
      queryClient,
      initialEntries: ["/sessions"],
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Filter sessions by start source" }));

    expect(screen.getByRole("option", { name: "Slack app mention received" })).toBeDefined();
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
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[44rem] table-fixed"',
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
    expect(screen.getByText("Profile metadata v3")).toBeDefined();
    expect(screen.queryByLabelText("pagination")).toBeNull();
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
      'data-slot="table" class="w-full caption-bottom text-sm min-w-[44rem] table-fixed"',
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
    expect(screen.getByText("Alpha Profile v3")).toBeDefined();
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

    expect(
      within(rendered.container).getByRole("link", { name: "Untitled" }).getAttribute("href"),
    ).toBe("/sessions/sbi_running");
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

    expect(within(rendered.container).queryByRole("link", { name: "Untitled" })).toBeNull();
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

  it("renders trigger names in the started by column without the source sublabel", () => {
    const queryClient = createSessionsPageQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    seedSessionsList({
      queryClient,
      items: [
        buildSandboxInstanceListItemFixture({
          id: "sbi_trigger",
          startedBy: {
            kind: "system",
            id: "aru_trigger",
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
});
