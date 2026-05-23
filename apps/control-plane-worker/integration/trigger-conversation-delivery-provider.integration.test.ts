/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  TriggerConversationCreatedByKinds,
  TriggerConversationDeliveryTaskStatuses,
  TriggerConversationOwnerKinds,
  TriggerConversationRouteStatuses,
  TriggerKinds,
  TriggerRunStatuses,
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

import { deliverConversationTriggerPayload } from "../openworkflow/handle-trigger-conversation-delivery/deliver-conversation-trigger-payload.js";
import type {
  AcquiredTriggerConnection,
  ResolvedTriggerConversationDeliveryRoute,
} from "../openworkflow/handle-trigger-conversation-delivery/types.js";
import { claimTriggerConversation } from "../openworkflow/shared/claim-conversation.js";
import { claimNextTriggerConversationDeliveryTask } from "../openworkflow/shared/claim-next-conversation-delivery-task.js";
import { enqueueTriggerConversationDeliveryTask } from "../openworkflow/shared/enqueue-conversation-delivery-task.js";
import type {
  EnsuredTriggerSandbox,
  PreparedTriggerRun,
} from "../openworkflow/shared/trigger-run-types.js";
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
      const triggerRunId = await insertTriggerRun({
        env,
        scope,
        webhookEventId,
        suffix: createSuffix("provider_failure_run"),
      });
      const task = await enqueueTriggerConversationDeliveryTask(
        { db: env.controlPlaneDb },
        {
          conversationId: scope.conversationId,
          triggerRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );
      const claimedTask = await claimNextTriggerConversationDeliveryTask(
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
      await env.controlPlaneDb.insert(env.controlPlaneTables.triggerConversationRoutes).values({
        id: routeId,
        conversationId: scope.conversationId,
        sandboxInstanceId,
        providerConversationId: "thread_123",
        providerExecutionId: null,
        providerState: {},
        status: TriggerConversationRouteStatuses.ACTIVE,
      });

      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const deliveryResult = context.with(
        activeContext,
        async () =>
          await deliverConversationTriggerPayload(
            {
              controlPlaneInternalClient: createControlPlaneInternalClient(env),
              db: env.controlPlaneDb,
              dataPlaneClient: createDataPlaneClient(env),
            },
            {
              taskId: task.id,
              generation: 1,
              preparedTriggerRun: createPreparedTriggerRun({
                triggerRunId,
                conversationId: scope.conversationId,
                organizationId: scope.organizationId,
                sandboxProfileId: scope.sandboxProfileId,
                webhookEventId,
              }),
              resolvedTriggerConversationRoute: createResolvedRoute({
                conversationId: scope.conversationId,
                routeId,
                sandboxInstanceId,
              }),
              ensuredTriggerSandbox: createEnsuredSandbox({ sandboxInstanceId }),
              acquiredTriggerConnection: createAcquiredConnection({ url: server.url }),
              workflowRunId: "owfr_delivery_provider_failure",
            },
          ),
      );
      await expect(deliveryResult).rejects.toThrow(SimulatedTurnStartFailureMessage);

      const persistedTask =
        await env.controlPlaneDb.query.triggerConversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.id, task.id),
        });
      expect(persistedTask).toEqual(
        expect.objectContaining({
          id: task.id,
          status: TriggerConversationDeliveryTaskStatuses.DELIVERING,
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
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
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
  triggerId: string;
  triggerTargetId: string;
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

function createEnsuredSandbox(input: { sandboxInstanceId: string }): EnsuredTriggerSandbox {
  return {
    sandboxInstanceId: input.sandboxInstanceId,
    startupWorkflowRunId: null,
  };
}

function createAcquiredConnection(input: { url: string }): AcquiredTriggerConnection {
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
}): ResolvedTriggerConversationDeliveryRoute {
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

function createPreparedTriggerRun(input: {
  triggerRunId: string;
  conversationId: string;
  organizationId: string;
  sandboxProfileId: string;
  webhookEventId: string;
}): PreparedTriggerRun {
  return {
    triggerRunId: input.triggerRunId,
    triggerRunCreatedAt: "2026-03-09T00:00:00.000Z",
    triggerId: "atm_delivery_provider_failure",
    conversationId: input.conversationId,
    triggerTargetId: "atg_delivery_provider_failure",
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: 1,
    primaryRepositoryId: null,
    workingDirectory: "/root",
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
  const triggerId = `atm_cdt_provider_${input.suffix}`;
  const triggerTargetId = `atg_cdt_provider_${input.suffix}`;
  const integrationConnectionId = `icn_cdt_provider_${input.suffix}`;
  const integrationWebhookSourceId = `iws_cdt_provider_${input.suffix}`;
  const targetKey = `github_cloud_cdt_provider_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Trigger Conversation Delivery Provider ${input.suffix}`,
    slug: `conversation-delivery-provider-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Trigger Conversation Delivery Provider ${input.suffix}`,
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
      displayName: `Trigger Conversation Delivery Provider ${input.suffix}`,
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
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
    id: triggerId,
    organizationId,
    kind: TriggerKinds.WEBHOOK,
    name: `Trigger Conversation Delivery Provider ${input.suffix}`,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerTargets).values({
    id: triggerTargetId,
    triggerId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });

  const conversation = await claimTriggerConversation(
    { db: input.env.controlPlaneDb },
    {
      organizationId,
      ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
      ownerId: triggerTargetId,
      createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
      createdById: triggerId,
      conversationKey: `conversation-${input.suffix}`,
      sandboxProfileId,
      integrationFamilyId: "openai",
      runtimeId: "codex",
    },
  );

  return {
    organizationId,
    sandboxProfileId,
    triggerId,
    triggerTargetId,
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

async function insertTriggerRun(input: {
  env: IntegrationTestEnvironment;
  scope: ConversationDeliveryScope;
  webhookEventId: string;
  suffix: string;
}): Promise<string> {
  const triggerRunId = `aru_cdt_provider_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerRuns).values({
    id: triggerRunId,
    triggerId: input.scope.triggerId,
    triggerTargetId: input.scope.triggerTargetId,
    conversationId: input.scope.conversationId,
    sourceWebhookEventId: input.webhookEventId,
    renderedInput: `input-${input.suffix}`,
    renderedConversationKey: `conversation-${input.suffix}`,
    status: TriggerRunStatuses.RUNNING,
  });

  return triggerRunId;
}
