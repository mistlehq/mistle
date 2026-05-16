// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { createAutomationListEvent } from "../automations/automation-list-test-fixtures.js";
import { automationsListQueryKey } from "../automations/automations-query-keys.js";
import type {
  AutomationListItem,
  AutomationsListResult,
} from "../automations/automations-types.js";
import { AutomationsPage } from "./automations-page.js";

function createListResult(
  items: AutomationsListResult["items"],
  overrides?: Partial<AutomationsListResult>,
): AutomationsListResult {
  return {
    items,
    nextPage: null,
    previousPage: null,
    totalResults: items.length,
    ...overrides,
  };
}

function createAutomationListItem(overrides?: Partial<AutomationListItem>): AutomationListItem {
  return {
    id: "atm_webhook_123",
    kind: "webhook",
    name: "Review trigger",
    enabled: true,
    target: {
      sandboxProfileId: "sbp_repo_maintainer",
      sandboxProfileName: "Repo Maintainer",
      primaryRepositoryId: "mistlehq/platform",
      primaryRepositoryName: "mistlehq/platform",
    },
    source: {
      kind: "webhook",
      events: [createAutomationListEvent()],
    },
    updatedAt: "2026-04-30T02:00:00.000Z",
    ...overrides,
  };
}

function seedAutomationsList(
  queryClient: ReturnType<typeof createTestQueryClient>,
  listResult: AutomationsListResult,
): void {
  queryClient.setQueryData(
    automationsListQueryKey({
      limit: 25,
      after: null,
      before: null,
    }),
    listResult,
  );
}

describe("AutomationsPage", () => {
  it("does not render pagination while the initial automation query has no data", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
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

    seedAutomationsList(queryClient, createListResult([createAutomationListItem()]));

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
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

    seedAutomationsList(queryClient, createListResult([]));

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
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

  it("renders the seeded automation without pagination when there is only one page", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedAutomationsList(
      queryClient,
      createListResult([
        createAutomationListItem({
          name: "Single trigger",
        }),
      ]),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Single trigger" })).toBeDefined();
    expect(screen.queryByLabelText("pagination")).toBeNull();
  });

  it("renders event and schedule automations from the unified list", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedAutomationsList(
      queryClient,
      createListResult([
        createAutomationListItem({
          name: "Event trigger",
        }),
        createAutomationListItem({
          id: "atm_schedule_123",
          kind: "schedule",
          name: "Daily schedule",
          target: {
            sandboxProfileId: "sbp_repo_maintainer",
            sandboxProfileName: "Repo Maintainer",
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
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Event trigger" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Daily schedule" })).toBeDefined();
    expect(screen.getByText("0 9 * * 1-5")).toBeDefined();
    expect(screen.getByText("Workspace root")).toBeDefined();
  });

  it("formats scheduled next-run times in the schedule timezone", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedAutomationsList(
      queryClient,
      createListResult([
        createAutomationListItem({
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
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Next Jul 1, 2026, 9:00 AM GMT-4")).toBeDefined();
  });

  it("does not render the result summary when the automation query is in error", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult = createListResult([createAutomationListItem()], {
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
    });

    seedAutomationsList(queryClient, listResult);
    const automationsListQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: automationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      queryFn: async () => listResult,
    });
    automationsListQuery.setState({
      ...automationsListQuery.state,
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
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).not.toContain("Showing 1 of 1");
    expect(markup).toContain('aria-label="pagination"');
  });

  it("updates the result summary when the list is filtered client-side", async () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedAutomationsList(
      queryClient,
      createListResult([
        createAutomationListItem({
          name: "Alpha trigger",
        }),
        createAutomationListItem({
          id: "atm_456",
          name: "Backlog sync",
          source: {
            kind: "webhook",
            events: [createAutomationListEvent({ label: "Issue comment created" })],
          },
        }),
      ]),
    );

    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Alpha trigger" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Backlog sync" })).toBeDefined();

    fireEvent.change(within(rendered.container).getByRole("textbox", { name: "Search triggers" }), {
      target: { value: "Backlog" },
    });

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Alpha trigger" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Backlog sync" })).toBeDefined();
  });
});
