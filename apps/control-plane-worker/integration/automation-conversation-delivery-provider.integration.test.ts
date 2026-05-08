/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  AutomationConversationCreatedByKinds,
  AutomationConversationDeliveryTaskStatuses,
  AutomationConversationOwnerKinds,
  AutomationConversationRouteStatuses,
  AutomationKinds,
  AutomationRunStatuses,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { context, TraceFlags, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterAll, beforeAll, describe, expect } from "vitest";

import { deliverConversationAutomationPayload } from "../openworkflow/handle-automation-conversation-delivery/deliver-conversation-automation-payload.js";
import type {
  AcquiredAutomationConnection,
  ResolvedAutomationConversationDeliveryRoute,
} from "../openworkflow/handle-automation-conversation-delivery/types.js";
import type {
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
} from "../openworkflow/shared/automation-run-types.js";
import { claimAutomationConversation } from "../openworkflow/shared/claim-conversation.js";
import { claimNextAutomationConversationDeliveryTask } from "../openworkflow/shared/claim-next-conversation-delivery-task.js";
import { enqueueAutomationConversationDeliveryTask } from "../openworkflow/shared/enqueue-conversation-delivery-task.js";
import {
  SimulatedTurnStartFailureMessage,
  startSimulatedCodexRuntimeServer,
} from "../test-support/simulated-codex-runtime-server.js";

const InternalServiceToken = "integration-new-internal-service-token";
const ParentSpanContext = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  traceFlags: TraceFlags.SAMPLED,
};
const contextManager = new AsyncLocalStorageContextManager();

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("control-plane worker conversation delivery provider boundary", () => {
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
  });

  it("marks delivery started before surfacing provider execution failure", async ({ env }) => {
    const server = await startSimulatedCodexRuntimeServer("turn_start_error");

    try {
      const scope = await seedConversationDeliveryScope({
        env,
        suffix: createSuffix("provider_failure"),
      });
      const webhookEventId = await insertWebhookEvent({
        env,
        scope,
        suffix: createSuffix("provider_failure_event"),
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const automationRunId = await insertAutomationRun({
        env,
        scope,
        webhookEventId,
        suffix: createSuffix("provider_failure_run"),
      });
      const task = await enqueueAutomationConversationDeliveryTask(
        { db: env.controlPlaneDb },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );
      const claimedTask = await claimNextAutomationConversationDeliveryTask(
        { db: env.controlPlaneDb },
        {
          conversationId: scope.conversationId,
          generation: 1,
        },
      );
      if (claimedTask === null) {
        throw new Error("Expected claimed delivery task.");
      }

      const sandboxInstanceId = `sbi_delivery_provider_failure_${randomUUID().replaceAll("-", "_")}`;
      const routeId = `cvr_delivery_provider_failure_${randomUUID().replaceAll("-", "_")}`;
      await env.controlPlaneDb.insert(env.controlPlaneTables.automationConversationRoutes).values({
        id: routeId,
        conversationId: scope.conversationId,
        sandboxInstanceId,
        providerConversationId: "thread_123",
        providerExecutionId: null,
        providerState: {},
        status: AutomationConversationRouteStatuses.ACTIVE,
      });

      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const deliveryResult = context.with(
        activeContext,
        async () =>
          await deliverConversationAutomationPayload(
            {
              controlPlaneInternalClient: createControlPlaneInternalClient(env),
              db: env.controlPlaneDb,
              dataPlaneClient: createDataPlaneClient(env),
            },
            {
              taskId: task.id,
              generation: 1,
              preparedAutomationRun: createPreparedAutomationRun({
                automationRunId,
                conversationId: scope.conversationId,
                organizationId: scope.organizationId,
                sandboxProfileId: scope.sandboxProfileId,
                webhookEventId,
              }),
              resolvedAutomationConversationRoute: createResolvedRoute({
                conversationId: scope.conversationId,
                routeId,
                sandboxInstanceId,
              }),
              ensuredAutomationSandbox: createEnsuredSandbox({ sandboxInstanceId }),
              acquiredAutomationConnection: createAcquiredConnection({ url: server.url }),
              workflowRunId: "owfr_delivery_provider_failure",
            },
          ),
      );
      await expect(deliveryResult).rejects.toThrow(SimulatedTurnStartFailureMessage);

      const persistedTask =
        await env.controlPlaneDb.query.automationConversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.id, task.id),
        });
      expect(persistedTask).toEqual(
        expect.objectContaining({
          id: task.id,
          status: AutomationConversationDeliveryTaskStatuses.DELIVERING,
          processorGeneration: 1,
          attemptCount: 1,
          failureCode: null,
          failureMessage: null,
          finishedAt: null,
        }),
      );
      expect(persistedTask?.deliveryStartedAt).not.toBeNull();
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "model/list",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });
});

type ConversationDeliveryScope = {
  organizationId: string;
  sandboxProfileId: string;
  automationId: string;
  automationTargetId: string;
  integrationConnectionId: string;
  integrationWebhookSourceId: string;
  targetKey: string;
  conversationId: string;
};

function createSuffix(label: string): string {
  return `${label}_${randomUUID().replaceAll("-", "_")}`;
}

function createControlPlaneInternalClient(
  env: IntegrationTestEnvironment,
): ControlPlaneInternalClient {
  return new ControlPlaneInternalClient({
    baseUrl: env.controlPlaneApi.hostBaseUrl,
    internalAuthServiceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function createDataPlaneClient(env: IntegrationTestEnvironment) {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function createEnsuredSandbox(input: { sandboxInstanceId: string }): EnsuredAutomationSandbox {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    startupWorkflowRunId: null,
  };
}

function createAcquiredConnection(input: { url: string }): AcquiredAutomationConnection {
  return {
    instanceId: "sbi_delivery_provider_failure",
    url: input.url,
    token: "connection-token",
    expiresAt: "2026-03-09T00:10:00.000Z",
  };
}

function createResolvedRoute(input: {
  conversationId: string;
  routeId: string;
  sandboxInstanceId: string;
}): ResolvedAutomationConversationDeliveryRoute {
  return {
    conversationId: input.conversationId,
    integrationFamilyId: "openai",
    runtimeId: "codex",
    routeId: input.routeId,
    sandboxInstanceId: input.sandboxInstanceId,
    providerConversationId: "thread_123",
    providerExecutionId: null,
    providerState: {},
  };
}

function createPreparedAutomationRun(input: {
  automationRunId: string;
  conversationId: string;
  organizationId: string;
  sandboxProfileId: string;
  webhookEventId: string;
}): PreparedAutomationRun {
  return {
    automationRunId: input.automationRunId,
    automationRunCreatedAt: "2026-03-09T00:00:00.000Z",
    automationId: "atm_delivery_provider_failure",
    conversationId: input.conversationId,
    automationTargetId: "atg_delivery_provider_failure",
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: 1,
    primaryRepositoryId: null,
    sourceKind: "webhook",
    sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    sourceWebhookEventId: input.webhookEventId,
    sourceScheduledActionId: undefined,
    integrationConnectionId: "icn_delivery_provider_failure",
    targetKey: "github_cloud_delivery_provider_failure",
    webhookEventId: input.webhookEventId,
    webhookEventType: "github.issue_comment.created",
    webhookProviderEventType: "issue_comment",
    webhookExternalEventId: "evt_delivery_provider_failure",
    webhookExternalDeliveryId: "delivery-provider-failure",
    webhookPayload: {},
    scheduledActionId: undefined,
    scheduledAt: undefined,
    localScheduledDate: undefined,
    localScheduledTime: undefined,
    renderedInput: "Handle this webhook.",
    renderedConversationKey: "conversation-delivery-provider-failure",
    renderedIdempotencyKey: "delivery-provider-failure",
    instructions: null,
    collaborationModeSettings: null,
  };
}

async function seedConversationDeliveryScope(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
}): Promise<ConversationDeliveryScope> {
  const organizationId = `org_cdt_provider_${input.suffix}`;
  const sandboxProfileId = `sbp_cdt_provider_${input.suffix}`;
  const automationId = `atm_cdt_provider_${input.suffix}`;
  const automationTargetId = `atg_cdt_provider_${input.suffix}`;
  const integrationConnectionId = `icn_cdt_provider_${input.suffix}`;
  const integrationWebhookSourceId = `iws_cdt_provider_${input.suffix}`;
  const targetKey = `github_cloud_cdt_provider_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Automation Conversation Delivery Provider ${input.suffix}`,
    slug: `conversation-delivery-provider-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Automation Conversation Delivery Provider ${input.suffix}`,
    status: "active",
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: integrationConnectionId,
      organizationId,
      targetKey,
      displayName: `Automation Conversation Delivery Provider ${input.suffix}`,
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: `subject-${input.suffix}`,
      config: {},
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationWebhookSources)
    .values({
      id: integrationWebhookSourceId,
      organizationId,
      integrationConnectionId,
      targetKey,
      endpointKey: `endpoint-${input.suffix}`,
      status: "active",
    });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Automation Conversation Delivery Provider ${input.suffix}`,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });

  const conversation = await claimAutomationConversation(
    { db: input.env.controlPlaneDb },
    {
      organizationId,
      ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
      ownerId: automationTargetId,
      createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
      createdById: automationId,
      conversationKey: `conversation-${input.suffix}`,
      sandboxProfileId,
      integrationFamilyId: "openai",
      runtimeId: "codex",
    },
  );

  return {
    organizationId,
    sandboxProfileId,
    automationId,
    automationTargetId,
    integrationConnectionId,
    integrationWebhookSourceId,
    targetKey,
    conversationId: conversation.id,
  };
}

async function insertWebhookEvent(input: {
  env: IntegrationTestEnvironment;
  scope: ConversationDeliveryScope;
  suffix: string;
  sourceOrderKey: string;
}): Promise<string> {
  const webhookEventId = `iwe_cdt_provider_${input.suffix}`;

  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationWebhookEvents)
    .values({
      id: webhookEventId,
      organizationId: input.scope.organizationId,
      integrationConnectionId: input.scope.integrationConnectionId,
      integrationWebhookSourceId: input.scope.integrationWebhookSourceId,
      targetKey: input.scope.targetKey,
      externalEventId: `evt-${input.suffix}`,
      externalDeliveryId: `delivery-${input.suffix}`,
      providerEventType: "issue_comment",
      eventType: "github.issue_comment.created",
      payload: {
        issue: {
          number: 1,
        },
        comment: {
          body: input.suffix,
        },
      },
      sourceOccurredAt: "2026-03-09T00:00:00.000Z",
      sourceOrderKey: input.sourceOrderKey,
      status: "processed",
    });

  return webhookEventId;
}

async function insertAutomationRun(input: {
  env: IntegrationTestEnvironment;
  scope: ConversationDeliveryScope;
  webhookEventId: string;
  suffix: string;
}): Promise<string> {
  const automationRunId = `aru_cdt_provider_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automationRuns).values({
    id: automationRunId,
    automationId: input.scope.automationId,
    automationTargetId: input.scope.automationTargetId,
    conversationId: input.scope.conversationId,
    sourceWebhookEventId: input.webhookEventId,
    renderedInput: `input-${input.suffix}`,
    renderedConversationKey: `conversation-${input.suffix}`,
    status: AutomationRunStatuses.RUNNING,
  });

  return automationRunId;
}
