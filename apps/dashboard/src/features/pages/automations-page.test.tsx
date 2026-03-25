// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY } from "../automations/use-webhook-automation-prerequisites.js";
import { webhookAutomationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import type { WebhookAutomationsListResult } from "../automations/webhook-automations-types.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import { automationApplicableSandboxProfilesQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import type { AutomationApplicableSandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import { AutomationsPage } from "./automations-page.js";

function seedAutomationPrerequisites(queryClient: ReturnType<typeof createTestQueryClient>): void {
  const connections: readonly IntegrationConnection[] = [
    {
      id: "icn_123",
      targetKey: "github",
      displayName: "GitHub Engineering",
      status: "active",
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
    },
  ];
  const targets: readonly IntegrationTarget[] = [
    {
      targetKey: "github",
      familyId: "github",
      variantId: "default",
      enabled: true,
      config: {},
      displayName: "GitHub",
      description: "GitHub integration",
      targetHealth: {
        configStatus: "valid",
      },
    },
  ];
  const sandboxProfiles: readonly AutomationApplicableSandboxProfile[] = [
    {
      createdAt: "2026-03-05T00:00:00.000Z",
      displayName: "Repo Maintainer",
      eligibleIntegrationConnectionIds: ["icn_123"],
      id: "sbp_123",
      latestVersion: 1,
      organizationId: "org_123",
      status: "active",
      updatedAt: "2026-03-05T00:00:00.000Z",
    },
  ];

  queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
    connections,
    targets,
  });
  queryClient.setQueryData(automationApplicableSandboxProfilesQueryKey(), {
    items: sandboxProfiles,
  });
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

  it("uses the sandbox profiles page header layout and shared table styling", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = {
      items: [
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-05T00:00:00.000Z",
          enabled: true,
          eventTypes: ["push"],
          id: "aut_123",
          idempotencyKeyTemplate: null,
          inputTemplate: "{{payload}}",
          integrationConnectionId: "icn_123",
          kind: "webhook",
          name: "Repo triage",
          payloadFilter: null,
          target: {
            id: "target_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    };
    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    seedAutomationPrerequisites(queryClient);

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
    const listResult: WebhookAutomationsListResult = {
      items: [
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-05T00:00:00.000Z",
          enabled: true,
          eventTypes: ["push"],
          id: "aut_123",
          idempotencyKeyTemplate: null,
          inputTemplate: "{{payload}}",
          integrationConnectionId: "icn_123",
          kind: "webhook",
          name: "Repo triage",
          payloadFilter: null,
          target: {
            id: "target_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 1,
    };
    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    seedAutomationPrerequisites(queryClient);

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

  it("does not render the result summary while prerequisites are still loading", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = {
      items: [
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-05T00:00:00.000Z",
          enabled: true,
          eventTypes: ["push"],
          id: "aut_123",
          idempotencyKeyTemplate: null,
          inputTemplate: "{{payload}}",
          integrationConnectionId: "icn_123",
          kind: "webhook",
          name: "Repo triage",
          payloadFilter: null,
          target: {
            id: "target_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
      previousPage: null,
      totalResults: 1,
    };

    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(markup).not.toContain("Showing 0 of 1");
    expect(markup).toContain(">Previous<");
    expect(markup).toContain(">Next<");
  });

  it("does not render the result summary when prerequisites fail", () => {
    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    const listResult: WebhookAutomationsListResult = {
      items: [
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-05T00:00:00.000Z",
          enabled: true,
          eventTypes: ["push"],
          id: "aut_123",
          idempotencyKeyTemplate: null,
          inputTemplate: "{{payload}}",
          integrationConnectionId: "icn_123",
          kind: "webhook",
          name: "Repo triage",
          payloadFilter: null,
          target: {
            id: "target_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
      previousPage: null,
      totalResults: 1,
    };

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

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

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
    const listResult: WebhookAutomationsListResult = {
      items: [
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-05T00:00:00.000Z",
          enabled: true,
          eventTypes: ["push"],
          id: "aut_123",
          idempotencyKeyTemplate: null,
          inputTemplate: "{{payload}}",
          integrationConnectionId: "icn_123",
          kind: "webhook",
          name: "Repo triage",
          payloadFilter: null,
          target: {
            id: "target_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: {
        after: "cursor_next",
        limit: 25,
      },
      previousPage: null,
      totalResults: 1,
    };

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
    const listResult: WebhookAutomationsListResult = {
      items: [
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-05T00:00:00.000Z",
          enabled: true,
          eventTypes: ["push"],
          id: "aut_123",
          idempotencyKeyTemplate: null,
          inputTemplate: "{{payload}}",
          integrationConnectionId: "icn_123",
          kind: "webhook",
          name: "Repo triage",
          payloadFilter: null,
          target: {
            id: "target_123",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
        {
          conversationKeyTemplate: "{{event.id}}",
          createdAt: "2026-03-05T00:00:00.000Z",
          enabled: true,
          eventTypes: ["push"],
          id: "aut_456",
          idempotencyKeyTemplate: null,
          inputTemplate: "{{payload}}",
          integrationConnectionId: "icn_123",
          kind: "webhook",
          name: "Backlog sync",
          payloadFilter: null,
          target: {
            id: "target_456",
            sandboxProfileId: "sbp_123",
            sandboxProfileVersion: null,
          },
          updatedAt: "2026-03-05T00:00:00.000Z",
        },
      ],
      nextPage: null,
      previousPage: null,
      totalResults: 2,
    };

    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    seedAutomationPrerequisites(queryClient);

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AutomationsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

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
