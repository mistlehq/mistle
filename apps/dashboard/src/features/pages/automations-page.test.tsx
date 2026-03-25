// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  createWebhookAutomationListEvent,
  createWebhookAutomationListItem,
} from "../automations/webhook-automation-test-fixtures.js";
import { webhookAutomationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import type { WebhookAutomationsListResult } from "../automations/webhook-automations-types.js";
import { AutomationsPage } from "./automations-page.js";

function createListResult(
  items: WebhookAutomationsListResult["items"],
  overrides?: Partial<WebhookAutomationsListResult>,
): WebhookAutomationsListResult {
  return {
    items,
    nextPage: null,
    previousPage: null,
    totalResults: items.length,
    ...overrides,
  };
}

function seedAutomationsList(
  queryClient: ReturnType<typeof createTestQueryClient>,
  listResult: WebhookAutomationsListResult,
): void {
  queryClient.setQueryData(
    webhookAutomationsListQueryKey({
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

    expect(markup).not.toContain(">Previous<");
    expect(markup).not.toContain(">Next<");
  });

  it("uses the expected page header and table styling", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedAutomationsList(queryClient, createListResult([createWebhookAutomationListItem()]));

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Automations");
    expect(markup).toContain("Create automation");
    expect(markup).toContain("justify-between");
    expect(markup).toContain("min-w-[56rem] table-fixed");
    expect(markup).toContain("bg-muted/60");
    expect(markup).toContain("text-xs font-semibold tracking-wide uppercase");
  });

  it("renders the result summary even when there is only one page", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedAutomationsList(queryClient, createListResult([createWebhookAutomationListItem()]));

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).toContain("Showing 1 of 1");
    expect(markup).not.toContain(">Previous<");
    expect(markup).not.toContain(">Next<");
  });

  it("does not render the result summary when the automation query is in error", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult = createListResult([createWebhookAutomationListItem()], {
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
    });

    seedAutomationsList(queryClient, listResult);
    const automationsListQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      queryFn: async () => listResult,
    });
    automationsListQuery.setState({
      ...automationsListQuery.state,
      data: listResult,
      error: new Error("Could not load automations."),
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
    expect(markup).toContain(">Next<");
  });

  it("updates the result summary when the list is filtered client-side", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    seedAutomationsList(
      queryClient,
      createListResult([
        createWebhookAutomationListItem(),
        createWebhookAutomationListItem({
          id: "aut_456",
          name: "Backlog sync",
          events: [createWebhookAutomationListEvent({ label: "Issue comment created" })],
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

    expect(screen.getByText("Showing 2 of 2")).toBeDefined();

    fireEvent.change(screen.getByRole("textbox", { name: "Search automations" }), {
      target: { value: "Backlog" },
    });

    expect(screen.getByText("Showing 1 of 2")).toBeDefined();
  });
});
