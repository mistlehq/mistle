// @vitest-environment jsdom

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createWebhookAutomationFixture,
  createWebhookAutomationsListResultFixture,
  seedAutomationPrerequisites,
} from "../../test-support/automations.js";
import { renderPageToStaticMarkup, renderPageWithClient } from "../../test-support/page-render.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import { WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY } from "../automations/use-webhook-automation-prerequisites.js";
import { webhookAutomationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import type { WebhookAutomationsListResult } from "../automations/webhook-automations-types.js";
import { AutomationsPage } from "./automations-page.js";

describe("AutomationsPage", () => {
  it("does not render pagination while the initial automation query has no data", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });

    const markup = renderPageToStaticMarkup({
      queryClient,
      element: <AutomationsPage />,
    });

    expect(markup).not.toContain(">Previous<");
    expect(markup).not.toContain(">Next<");
  });

  it("uses the sandbox profiles page header layout and shared table styling", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = createWebhookAutomationsListResultFixture();
    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    seedAutomationPrerequisites(queryClient);

    const markup = renderPageToStaticMarkup({
      queryClient,
      element: <AutomationsPage />,
    });

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
    const listResult: WebhookAutomationsListResult = createWebhookAutomationsListResultFixture();
    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    seedAutomationPrerequisites(queryClient);

    const markup = renderPageToStaticMarkup({
      queryClient,
      element: <AutomationsPage />,
    });

    expect(markup).toContain("Showing 1 of 1");
    expect(markup).not.toContain(">Previous<");
    expect(markup).not.toContain(">Next<");
  });

  it("does not render the result summary while prerequisites are still loading", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = createWebhookAutomationsListResultFixture({
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
    });

    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );

    const markup = renderPageToStaticMarkup({
      queryClient,
      element: <AutomationsPage />,
    });

    expect(markup).not.toContain("Showing 0 of 1");
    expect(markup).toContain(">Previous<");
    expect(markup).toContain(">Next<");
  });

  it("does not render the result summary when prerequisites fail", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = createWebhookAutomationsListResultFixture({
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
    });

    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    const prerequisitesQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
      queryFn: async () => {
        throw new Error("Could not load automation prerequisites.");
      },
    });
    prerequisitesQuery.setState({
      ...prerequisitesQuery.state,
      error: new Error("Could not load automation prerequisites."),
      errorUpdateCount: 1,
      errorUpdatedAt: Date.now(),
      fetchStatus: "idle",
      status: "error",
    });

    const markup = renderPageToStaticMarkup({
      queryClient,
      element: <AutomationsPage />,
    });

    expect(markup).not.toContain("Showing 0 of 1");
    expect(markup).not.toContain("Showing 1 of 1");
    expect(markup).toContain(">Previous<");
    expect(markup).toContain(">Next<");
  });

  it("does not render the result summary when the automation query is in error", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = createWebhookAutomationsListResultFixture({
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
    });

    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    seedAutomationPrerequisites(queryClient);
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

    const markup = renderPageToStaticMarkup({
      queryClient,
      element: <AutomationsPage />,
    });

    expect(markup).not.toContain("Showing 1 of 1");
    expect(markup).toContain(">Next<");
  });

  it("updates the result summary when the list is filtered client-side", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = createWebhookAutomationsListResultFixture({
      items: [
        createWebhookAutomationFixture(),
        createWebhookAutomationFixture({
          id: "aut_456",
          name: "Backlog sync",
          target: {
            id: "target_456",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
        }),
      ],
      totalResults: 2,
    });

    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    seedAutomationPrerequisites(queryClient);

    renderPageWithClient({
      queryClient,
      element: <AutomationsPage />,
    });

    expect(
      screen
        .getAllByText((content, element) => {
          return element?.textContent === "Showing 2 of 2";
        })
        .at(-1),
    ).toBeDefined();

    fireEvent.change(screen.getByRole("textbox", { name: "Search automations" }), {
      target: { value: "Backlog" },
    });

    expect(
      screen
        .getAllByText((content, element) => {
          return element?.textContent === "Showing 1 of 2";
        })
        .at(-1),
    ).toBeDefined();
  });
});
