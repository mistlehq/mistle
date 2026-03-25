import type { QueryClient } from "@tanstack/react-query";

import { WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY } from "../features/automations/use-webhook-automation-prerequisites.js";
import type {
  WebhookAutomation,
  WebhookAutomationsListResult,
} from "../features/automations/webhook-automations-types.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../features/integrations/integrations-service.js";
import { automationApplicableSandboxProfilesQueryKey } from "../features/sandbox-profiles/sandbox-profiles-query-keys.js";
import type { AutomationApplicableSandboxProfile } from "../features/sandbox-profiles/sandbox-profiles-types.js";

export function createAutomationApplicableSandboxProfileFixture(
  input?: Partial<AutomationApplicableSandboxProfile>,
): AutomationApplicableSandboxProfile {
  return {
    id: "sbp_123",
    organizationId: "org_123",
    displayName: "Repo Maintainer",
    status: "active",
    latestVersion: 1,
    eligibleIntegrationConnectionIds: ["icn_123"],
    createdAt: "2026-03-05T00:00:00.000Z",
    updatedAt: "2026-03-05T00:00:00.000Z",
    ...input,
  };
}

export function createWebhookAutomationFixture(
  input?: Partial<WebhookAutomation>,
): WebhookAutomation {
  return {
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
    ...input,
  };
}

export function createWebhookAutomationsListResultFixture(input?: {
  items?: readonly WebhookAutomation[];
  nextPage?: WebhookAutomationsListResult["nextPage"];
  previousPage?: WebhookAutomationsListResult["previousPage"];
  totalResults?: number;
}): WebhookAutomationsListResult {
  const items = input?.items ?? [createWebhookAutomationFixture()];

  return {
    items: [...items],
    nextPage: input?.nextPage ?? null,
    previousPage: input?.previousPage ?? null,
    totalResults: input?.totalResults ?? items.length,
  };
}

export function seedAutomationPrerequisites(
  queryClient: QueryClient,
  input?: {
    connections?: readonly IntegrationConnection[];
    sandboxProfiles?: readonly AutomationApplicableSandboxProfile[];
    targets?: readonly IntegrationTarget[];
  },
): void {
  const connections = input?.connections ?? [
    {
      id: "icn_123",
      targetKey: "github",
      displayName: "GitHub Engineering",
      status: "active",
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
    },
  ];
  const targets = input?.targets ?? [
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
  const sandboxProfiles = input?.sandboxProfiles ?? [
    createAutomationApplicableSandboxProfileFixture(),
  ];

  queryClient.setQueryData(WEBHOOK_AUTOMATION_INTEGRATION_DIRECTORY_QUERY_KEY, {
    connections,
    targets,
  });
  queryClient.setQueryData(automationApplicableSandboxProfilesQueryKey(), {
    items: sandboxProfiles,
  });
}
