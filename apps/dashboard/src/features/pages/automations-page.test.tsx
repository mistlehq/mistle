// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY,
} from "../automations/use-webhook-automation-prerequisites.js";
import { webhookAutomationsListQueryKey } from "../automations/webhook-automations-query-keys.js";
import type { WebhookAutomationsListResult } from "../automations/webhook-automations-types.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import { AutomationsPage } from "./automations-page.js";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}

describe("AutomationsPage", () => {
  it("uses the sandbox profiles page header layout and shared table styling", () => {
    const queryClient = createQueryClient();
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
    const sandboxProfiles: readonly SandboxProfile[] = [
      {
        createdAt: "2026-03-05T00:00:00.000Z",
        displayName: "Repo Maintainer",
        id: "sbp_123",
        organizationId: "org_123",
        status: "active",
        updatedAt: "2026-03-05T00:00:00.000Z",
      },
    ];

    queryClient.setQueryData(
      webhookAutomationsListQueryKey({
        limit: 25,
        after: null,
        before: null,
      }),
      listResult,
    );
    queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
      connections,
      targets,
    });
    queryClient.setQueryData(WEBHOOK_AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, sandboxProfiles);

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
});
