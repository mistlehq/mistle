// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  automationDetailQueryKey,
  scheduledAutomationDetailQueryKey,
} from "../automations/automations-query-keys.js";
import type { AutomationListItem } from "../automations/automations-types.js";
import { ScheduledAutomationSameConversationKeyTemplate } from "../automations/scheduled-automation-form-helpers.js";
import type { ScheduledAutomation } from "../automations/scheduled-automations-types.js";
import { AUTOMATION_SANDBOX_PROFILES_QUERY_KEY } from "../automations/use-automation-sandbox-profile-options.js";
import { ROUTE_HANDLES } from "../navigation/route-handles.js";
import { sandboxProfileVersionAutomationConfigQueryKey } from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import { TriggerEditorContent } from "./trigger-editor-content.js";
import { TriggerEditorPage } from "./trigger-editor-page.js";

const TriggerId = "atm_schedule_test";
const SandboxProfileId = "sbp_schedule_profile";

function createScheduleAutomationSummary(
  overrides?: Partial<AutomationListItem>,
): AutomationListItem {
  return {
    id: TriggerId,
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

function createScheduledAutomationDetail(): ScheduledAutomation {
  return {
    id: TriggerId,
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
    conversationKeyTemplate: ScheduledAutomationSameConversationKeyTemplate,
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

function seedScheduledTriggerEditor(
  queryClient: ReturnType<typeof createTestQueryClient>,
  automationSummary: AutomationListItem,
): void {
  queryClient.setQueryData(automationDetailQueryKey(automationSummary.id), automationSummary);
  queryClient.setQueryData(
    scheduledAutomationDetailQueryKey(automationSummary.id),
    createScheduledAutomationDetail(),
  );
  queryClient.setQueryData(AUTOMATION_SANDBOX_PROFILES_QUERY_KEY, [
    {
      id: SandboxProfileId,
      displayName: "Schedule Profile",
    },
  ]);
  queryClient.setQueryData(
    sandboxProfileVersionAutomationConfigQueryKey({
      profileId: SandboxProfileId,
      version: 1,
    }),
    {
      bindings: [],
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
    seedScheduledTriggerEditor(queryClient, createScheduleAutomationSummary());
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={<TriggerEditorPage />}
          handle={ROUTE_HANDLES.triggersDetail}
          path="/triggers/:triggerId"
        />,
      ),
      {
        initialEntries: [`/triggers/${TriggerId}`],
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
});

describe("TriggerEditorContent", () => {
  it("rejects a trigger that does not belong to the required sandbox profile", async () => {
    const queryClient = createEditorQueryClient();
    seedScheduledTriggerEditor(
      queryClient,
      createScheduleAutomationSummary({
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
          triggerId={TriggerId}
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
