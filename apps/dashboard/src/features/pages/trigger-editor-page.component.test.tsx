// @vitest-environment jsdom

import { GitHubCloudBrowserDefinition } from "@mistle/integrations-definitions/browser";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { createStoryWebhookTriggerCapabilitiesProviderMetadata } from "../integrations/integration-story-harness.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { sandboxProfileVersionTriggerConfigQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { ScheduledTriggerSameConversationKeyTemplate } from "../triggers/scheduled-trigger-form-helpers.js";
import type { ScheduledTrigger } from "../triggers/scheduled-triggers-types.js";
import {
  triggerDetailQueryKey,
  scheduledTriggerDetailQueryKey,
  webhookTriggerDetailQueryKey,
} from "../triggers/triggers-query-keys.js";
import type { TriggerListItem } from "../triggers/triggers-types.js";
import { TRIGGER_SANDBOX_PROFILES_QUERY_KEY } from "../triggers/use-trigger-sandbox-profile-options.js";
import {
  WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY,
  WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX,
} from "../triggers/use-webhook-trigger-prerequisites.js";
import type { WebhookTrigger } from "../triggers/webhook-triggers-types.js";
import { TriggerEditorContent } from "./trigger-editor-content.js";
import { TriggerEditorPage } from "./trigger-editor-page.js";

const ScheduleTriggerId = "atm_schedule_test";
const WebhookTriggerId = "atm_webhook_test";
const SandboxProfileId = "sbp_schedule_profile";
const GitHubConnectionId = "icn_github_trigger_editor";
const GitHubWebhookSourceId = "iws_github_trigger_editor";

function createScheduleTriggerSummary(overrides?: Partial<TriggerListItem>): TriggerListItem {
  return {
    id: ScheduleTriggerId,
    kind: "schedule",
    name: "Daily schedule",
    enabled: true,
    target: {
      sandboxProfileId: SandboxProfileId,
      sandboxProfileName: "Schedule Profile",
      primaryRepositoryId: null,
      primaryRepositoryName: null,
    },
    source: {
      kind: "schedule",
      cronExpression: "0 9 * * 1-5",
      timezone: "Asia/Singapore",
      nextScheduledAt: "2026-05-18T01:00:00.000Z",
    },
    updatedAt: "2026-05-16T02:00:00.000Z",
    ...overrides,
  };
}

function createWebhookTriggerSummary(overrides?: Partial<TriggerListItem>): TriggerListItem {
  return {
    id: WebhookTriggerId,
    kind: "webhook",
    name: "Webhook trigger",
    enabled: true,
    target: {
      sandboxProfileId: SandboxProfileId,
      sandboxProfileName: "Schedule Profile",
      primaryRepositoryId: null,
      primaryRepositoryName: null,
    },
    source: {
      kind: "webhook",
      events: [
        {
          label: "Pull request",
          logoKey: GitHubCloudBrowserDefinition.logoKey,
        },
      ],
    },
    updatedAt: "2026-05-16T02:00:00.000Z",
    ...overrides,
  };
}

function createScheduledTriggerDetail(): ScheduledTrigger {
  return {
    id: ScheduleTriggerId,
    kind: "schedule",
    name: "Daily schedule",
    enabled: true,
    schedule: {
      id: "ats_schedule_test",
      name: "Daily schedule",
      cronExpression: "0 9 * * 1-5",
      timezone: "Asia/Singapore",
      enabled: true,
      nextScheduledAt: "2026-05-18T01:00:00.000Z",
      lastScheduledAt: null,
    },
    inputTemplate: "Review open work.",
    conversationKeyTemplate: ScheduledTriggerSameConversationKeyTemplate,
    idempotencyKeyTemplate: null,
    target: {
      id: "att_schedule_test",
      sandboxProfileId: SandboxProfileId,
      sandboxProfileVersion: 1,
      primaryRepositoryId: null,
    },
    createdAt: "2026-05-16T01:00:00.000Z",
    updatedAt: "2026-05-16T02:00:00.000Z",
  };
}

function createWebhookTriggerDetail(): WebhookTrigger {
  return {
    id: WebhookTriggerId,
    kind: "webhook",
    name: "Webhook trigger",
    enabled: true,
    integrationWebhookSourceId: GitHubWebhookSourceId,
    eventTypes: ["pull_request"],
    payloadFilter: null,
    inputTemplate: "Review the pull request.",
    instructions: null,
    conversationKeyTemplate: "",
    idempotencyKeyTemplate: null,
    target: {
      id: "att_webhook_test",
      sandboxProfileId: SandboxProfileId,
      sandboxProfileVersion: 1,
      primaryRepositoryId: null,
    },
    createdAt: "2026-05-16T01:00:00.000Z",
    updatedAt: "2026-05-16T02:00:00.000Z",
  };
}

function seedScheduledTriggerEditor(
  queryClient: ReturnType<typeof createTestQueryClient>,
  triggerSummary: TriggerListItem,
): void {
  queryClient.setQueryData(triggerDetailQueryKey(triggerSummary.id), triggerSummary);
  queryClient.setQueryData(
    scheduledTriggerDetailQueryKey(triggerSummary.id),
    createScheduledTriggerDetail(),
  );
  queryClient.setQueryData(TRIGGER_SANDBOX_PROFILES_QUERY_KEY, [
    {
      id: SandboxProfileId,
      displayName: "Schedule Profile",
    },
  ]);
  queryClient.setQueryData(
    sandboxProfileVersionTriggerConfigQueryKey({
      profileId: SandboxProfileId,
      version: 1,
    }),
    {
      bindings: [],
      repositoryOptions: [],
    },
  );
}

function seedWebhookTriggerEditor(
  queryClient: ReturnType<typeof createTestQueryClient>,
  triggerSummary: TriggerListItem,
): void {
  queryClient.setQueryData(triggerDetailQueryKey(triggerSummary.id), triggerSummary);
  queryClient.setQueryData(
    webhookTriggerDetailQueryKey(triggerSummary.id),
    createWebhookTriggerDetail(),
  );
  queryClient.setQueryData(TRIGGER_SANDBOX_PROFILES_QUERY_KEY, [
    {
      id: SandboxProfileId,
      displayName: "Schedule Profile",
    },
  ]);
  queryClient.setQueryData(WEBHOOK_TRIGGER_INTEGRATION_DIRECTORY_QUERY_KEY, {
    connections: [
      {
        id: GitHubConnectionId,
        targetKey: "github-cloud",
        displayName: "GitHub",
        status: "active",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
    ],
    targets: [
      {
        targetKey: "github-cloud",
        familyId: GitHubCloudBrowserDefinition.familyId,
        variantId: GitHubCloudBrowserDefinition.variantId,
        kind: GitHubCloudBrowserDefinition.kind,
        enabled: true,
        config: {},
        displayName: GitHubCloudBrowserDefinition.displayName,
        description: "GitHub repositories",
        ...(GitHubCloudBrowserDefinition.logoKey === undefined
          ? {}
          : { logoKey: GitHubCloudBrowserDefinition.logoKey }),
        supportedWebhookEvents: GitHubCloudBrowserDefinition.supportedWebhookEvents,
        targetHealth: {
          configStatus: "valid",
        },
      },
    ],
  });
  queryClient.setQueryData(
    [...WEBHOOK_TRIGGER_WEBHOOK_SOURCES_QUERY_KEY_PREFIX, GitHubConnectionId],
    [
      {
        id: GitHubWebhookSourceId,
        targetKey: "github-cloud",
        integrationConnectionId: GitHubConnectionId,
        displayName: "GitHub webhook",
        endpointKey: "ep_github_test",
        status: "active",
        providerMetadata: createStoryWebhookTriggerCapabilitiesProviderMetadata({
          definition: GitHubCloudBrowserDefinition,
          events: ["pull_request"],
          permissions: [{ permission: "pull_requests", access: "read" }],
        }),
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-08T00:00:00.000Z",
      },
    ],
  );
  queryClient.setQueryData(
    sandboxProfileVersionTriggerConfigQueryKey({
      profileId: SandboxProfileId,
      version: 1,
    }),
    {
      bindings: [
        {
          id: "bnd_github_trigger_editor",
          sandboxProfileId: SandboxProfileId,
          sandboxProfileVersion: 1,
          connectionId: GitHubConnectionId,
          kind: "git",
          config: {},
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-08T00:00:00.000Z",
        },
      ],
      repositoryOptions: [],
    },
  );
}

function createEditorQueryClient(): ReturnType<typeof createTestQueryClient> {
  return createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

describe("TriggerEditorPage", () => {
  it("uses the loaded trigger summary to render the scheduled trigger editor", async () => {
    const queryClient = createEditorQueryClient();
    seedScheduledTriggerEditor(queryClient, createScheduleTriggerSummary());
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={<TriggerEditorPage />}
          handle={ROUTE_HANDLES.triggersDetail}
          path="/triggers/:triggerId"
        />,
      ),
      {
        initialEntries: [`/triggers/${ScheduleTriggerId}`],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByDisplayValue("0 9 * * 1-5")).toBeDefined();
    expect(screen.getByText("Trigger source")).toBeDefined();
    expect(screen.getAllByText("Schedule").length).toBeGreaterThan(0);
  });

  it("uses the loaded trigger summary to render the webhook trigger editor", async () => {
    const queryClient = createEditorQueryClient();
    seedWebhookTriggerEditor(queryClient, createWebhookTriggerSummary());
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={<TriggerEditorPage />}
          handle={ROUTE_HANDLES.triggersDetail}
          path="/triggers/:triggerId"
        />,
      ),
      {
        initialEntries: [`/triggers/${WebhookTriggerId}`],
      },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByDisplayValue("Webhook trigger")).toBeDefined();
    expect(screen.getByText("Trigger source")).toBeDefined();
    expect(screen.getAllByText("Event").length).toBeGreaterThan(0);
  });
});

describe("TriggerEditorContent", () => {
  it("rejects a trigger that does not belong to the required sandbox profile", async () => {
    const queryClient = createEditorQueryClient();
    seedScheduledTriggerEditor(
      queryClient,
      createScheduleTriggerSummary({
        target: {
          sandboxProfileId: "sbp_other_profile",
          sandboxProfileName: "Other Profile",
          primaryRepositoryId: null,
          primaryRepositoryName: null,
        },
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <TriggerEditorContent
          triggerId={ScheduleTriggerId}
          backPath="/sandbox-profiles/sbp_schedule_profile/triggers"
          deleteSuccessPath="/sandbox-profiles/sbp_schedule_profile/triggers"
          navigate={() => {}}
          requiredSandboxProfileId={SandboxProfileId}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Trigger not found for this sandbox profile")).toBeDefined();
  });
});
