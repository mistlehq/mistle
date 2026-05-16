// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { createTriggerListEvent } from "../triggers/trigger-list-test-fixtures.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import type { TriggerListItem, TriggersListResult } from "../triggers/triggers-types.js";
import { TriggersPage } from "./triggers-page.js";

function createListResult(
  items: TriggersListResult["items"],
  overrides?: Partial<TriggersListResult>,
): TriggersListResult {
  return {
    items,
    nextPage: null,
    previousPage: null,
    totalResults: items.length,
    ...overrides,
  };
}

function createTriggerListItem(overrides?: Partial<TriggerListItem>): TriggerListItem {
  return {
    id: "atm_webhook_123",
    kind: "webhook",
    name: "Review trigger",
    enabled: true,
    target: {
      sandboxProfileId: "sbp_repo_maintainer",
      sandboxProfileName: "Repo Maintainer",
      sandboxProfileVersion: 3,
      primaryRepositoryId: "mistlehq/platform",
      primaryRepositoryName: "mistlehq/platform",
    },
    source: {
      kind: "webhook",
      events: [createTriggerListEvent()],
    },
    updatedAt: "2026-04-30T02:00:00.000Z",
    ...overrides,
  };
}

function seedTriggersList(
  queryClient: ReturnType<typeof createTestQueryClient>,
  listResult: TriggersListResult,
  query?: {
    kind?: "webhook" | "schedule";
    enabled?: boolean;
    search?: string;
  },
): void {
  queryClient.setQueryData(
    triggersListQueryKey({
      limit: 25,
      after: null,
      before: null,
      ...query,
    }),
    listResult,
  );
}

function LocationProbe(input: { onPathChange: (path: string) => void }): null {
  const location = useLocation();
  input.onPathChange(`${location.pathname}${location.search}`);
  return null;
}

describe("TriggersPage", () => {
  it("does not render pagination while the initial trigger query has no data", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).not.toContain('aria-label="pagination"');
  });

  it("uses the expected page header and table styling", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(queryClient, createListResult([createTriggerListItem()]));

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Triggers");
    expect(markup).toContain("Create");
    expect(markup).toContain("justify-between");
    expect(markup).toContain('data-slot="table-container" class="relative w-full overflow-x-auto"');
    expect(markup).toContain('data-slot="table" class="w-full caption-bottom text-sm table-fixed"');
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-xs font-semibold tracking-wide uppercase");
  });

  it("shows first-use guidance when there are no triggers", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(queryClient, createListResult([]));

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Create your first trigger" })).toBeDefined();
    expect(
      screen.getByText("Triggers run Mistle automatically from webhook events or schedules."),
    ).toBeDefined();
    expect(screen.getAllByRole("button", { name: /Create/i })).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders the seeded trigger without pagination when there is only one page", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          name: "Single trigger",
        }),
      ]),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Single trigger" })).toBeDefined();
    expect(screen.queryByLabelText("pagination")).toBeNull();
  });

  it("renders event and schedule triggers from the unified list", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          name: "Event trigger",
        }),
        createTriggerListItem({
          id: "atm_schedule_123",
          kind: "schedule",
          name: "Daily schedule",
          target: {
            sandboxProfileId: "sbp_repo_maintainer",
            sandboxProfileName: "Repo Maintainer",
            sandboxProfileVersion: 3,
            primaryRepositoryId: null,
            primaryRepositoryName: null,
          },
          source: {
            kind: "schedule",
            cronExpression: "0 9 * * 1-5",
            timezone: "Asia/Singapore",
            nextScheduledAt: "2026-05-04T01:00:00.000Z",
          },
        }),
      ]),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Event trigger" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Daily schedule" })).toBeDefined();
    expect(screen.getByText("0 9 * * 1-5")).toBeDefined();
    expect(screen.getAllByText("Repo Maintainer v3").length).toBeGreaterThan(0);
    expect(screen.getByText("Workspace root")).toBeDefined();
  });

  it("formats scheduled next-run times in the schedule timezone", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          id: "atm_schedule_new_york",
          kind: "schedule",
          name: "New York morning schedule",
          source: {
            kind: "schedule",
            cronExpression: "0 9 * * *",
            timezone: "America/New_York",
            nextScheduledAt: "2026-07-01T13:00:00.000Z",
          },
        }),
      ]),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Next Jul 1, 2026, 9:00 AM GMT-4")).toBeDefined();
  });

  it("does not render the result summary when the trigger query is in error", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult = createListResult([createTriggerListItem()], {
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
    });

    seedTriggersList(queryClient, listResult);
    const triggersListQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: triggersListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      queryFn: async () => listResult,
    });
    triggersListQuery.setState({
      ...triggersListQuery.state,
      data: listResult,
      error: new Error("Could not load triggers."),
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle",
      status: "error",
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).not.toContain("Showing 1 of 1");
    expect(markup).toContain('aria-label="pagination"');
  });

  it("updates the result summary from server-backed search results", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          name: "Alpha trigger",
        }),
        createTriggerListItem({
          id: "atm_456",
          name: "Backlog sync",
          source: {
            kind: "webhook",
            events: [createTriggerListEvent({ label: "Issue comment created" })],
          },
        }),
      ]),
    );
    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          id: "atm_456",
          name: "Backlog sync",
          source: {
            kind: "webhook",
            events: [createTriggerListEvent({ label: "Issue comment created" })],
          },
        }),
      ]),
      { search: "Backlog" },
    );

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Alpha trigger" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Backlog sync" })).toBeDefined();
    expect(
      within(rendered.container)
        .getByRole("textbox", { name: "Search triggers" })
        .getAttribute("placeholder"),
    ).toBe("Search triggers");

    fireEvent.change(within(rendered.container).getByRole("textbox", { name: "Search triggers" }), {
      target: { value: "Backlog" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Alpha trigger" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Backlog sync" })).toBeDefined();
    expect(screen.getByText("Showing 1 of 1")).toBeDefined();
  });

  it("keeps the search and filter toolbar visible for server-backed empty results", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          name: "Alpha trigger",
        }),
      ]),
    );
    seedTriggersList(queryClient, createListResult([]), { search: "missing" });

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(within(rendered.container).getByRole("textbox", { name: "Search triggers" }), {
      target: { value: "missing" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Alpha trigger" })).toBeNull();
    });
    expect(
      within(rendered.container).getByRole("textbox", { name: "Search triggers" }),
    ).toBeDefined();
    expect(
      within(rendered.container).getByRole("combobox", { name: "Filter triggers" }),
    ).toBeDefined();
    expect(screen.getByText("No triggers match the current search or filter.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Create your first trigger" })).toBeNull();
  });

  it("keeps the search toolbar visible while server-backed search results are loading", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          name: "Alpha trigger",
        }),
      ]),
    );

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const searchInput = within(rendered.container).getByRole("textbox", {
      name: "Search triggers",
    });
    fireEvent.change(searchInput, {
      target: { value: "unseeded" },
    });

    expect(within(rendered.container).getByRole("textbox", { name: "Search triggers" })).toBe(
      searchInput,
    );
    expect(screen.getByDisplayValue("unseeded")).toBeDefined();
  });

  it("opens webhook and schedule triggers through the unified trigger detail route", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const paths: string[] = [];

    seedTriggersList(
      queryClient,
      createListResult([
        createTriggerListItem({
          id: "atm_webhook_open",
          name: "Webhook trigger",
        }),
        createTriggerListItem({
          id: "atm_schedule_open",
          kind: "schedule",
          name: "Schedule trigger",
          source: {
            kind: "schedule",
            cronExpression: "0 9 * * *",
            timezone: "Asia/Singapore",
            nextScheduledAt: "2026-04-30T01:00:00.000Z",
          },
        }),
      ]),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/triggers"]}>
          <LocationProbe onPathChange={(path) => paths.push(path)} />
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Webhook trigger" }));
    expect(paths.at(-1)).toBe("/triggers/atm_webhook_open");

    fireEvent.click(screen.getByRole("button", { name: "Schedule trigger" }));
    expect(paths.at(-1)).toBe("/triggers/atm_schedule_open");
  });
});
