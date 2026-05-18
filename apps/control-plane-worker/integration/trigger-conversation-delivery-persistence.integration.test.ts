/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  TriggerConversationCreatedByKinds,
  TriggerConversationDeliveryProcessorStatuses,
  TriggerConversationDeliveryTaskStatuses,
  TriggerConversationOwnerKinds,
  TriggerKinds,
  TriggerRunStatuses,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { finalizeTriggerConversationDeliveryTask } from "../openworkflow/handle-trigger-conversation-delivery/finalize-trigger-conversation-delivery-task.js";
import { idleTriggerConversationDeliveryProcessorIfEmpty } from "../openworkflow/handle-trigger-conversation-delivery/idle-trigger-conversation-delivery-processor-if-empty.js";
import { resolveTriggerConversationDeliveryTaskAction } from "../openworkflow/handle-trigger-conversation-delivery/resolve-trigger-conversation-delivery-task-action.js";
import { claimTriggerConversation } from "../openworkflow/shared/claim-conversation.js";
import { claimNextTriggerConversationDeliveryTask } from "../openworkflow/shared/claim-next-conversation-delivery-task.js";
import { enqueueTriggerConversationDeliveryTask } from "../openworkflow/shared/enqueue-conversation-delivery-task.js";
import { ensureTriggerConversationDeliveryProcessor } from "../openworkflow/shared/ensure-conversation-delivery-processor.js";
import { findActiveTriggerConversationDeliveryTask } from "../openworkflow/shared/find-active-conversation-delivery-task.js";
import { markTriggerConversationDeliveryTaskDelivering } from "../openworkflow/shared/mark-conversation-delivery-task-delivering.js";
import { TriggerConversationPersistenceErrorCodes } from "../openworkflow/shared/trigger-conversation-persistence-error.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

describe.concurrent("control-plane worker conversation delivery persistence", () => {
  it("enqueues one delivery task per trigger run and reuses the existing row", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("enqueue_idempotent"),
    });
    const webhookEventId = await insertWebhookEvent({
      env,
      scope,
      suffix: createSuffix("enqueue_idempotent_event"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });
    const triggerRunId = await insertTriggerRun({
      env,
      scope,
      webhookEventId,
      suffix: createSuffix("enqueue_idempotent_run"),
    });

    const firstTask = await enqueueTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        triggerRunId,
        sourceWebhookEventId: webhookEventId,
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      },
    );
    const secondTask = await enqueueTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        triggerRunId,
        sourceWebhookEventId: webhookEventId,
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      },
    );

    expect(secondTask.id).toBe(firstTask.id);

    const persistedTasks = await env.controlPlaneDb.query.triggerConversationDeliveryTasks.findMany(
      {
        where: (table, { eq }) => eq(table.triggerRunId, triggerRunId),
      },
    );
    expect(persistedTasks).toHaveLength(1);
    expect(persistedTasks[0]?.status).toBe(TriggerConversationDeliveryTaskStatuses.QUEUED);
  });

  it("rejects conflicting task input for the same trigger run", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("enqueue_mismatch"),
    });
    const webhookEventId = await insertWebhookEvent({
      env,
      scope,
      suffix: createSuffix("enqueue_mismatch_event"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });
    const triggerRunId = await insertTriggerRun({
      env,
      scope,
      webhookEventId,
      suffix: createSuffix("enqueue_mismatch_run"),
    });

    await enqueueTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        triggerRunId,
        sourceWebhookEventId: webhookEventId,
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      },
    );

    await expect(
      enqueueTriggerConversationDeliveryTask(
        { db: env.controlPlaneDb },
        {
          conversationId: scope.conversationId,
          triggerRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0002",
        },
      ),
    ).rejects.toMatchObject({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
    });
  });

  it("starts one delivery processor and reuses it until it returns to idle", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("ensure_processor"),
    });

    const firstEnsure = await ensureTriggerConversationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
      },
    );
    const secondEnsure = await ensureTriggerConversationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
      },
    );

    expect(firstEnsure).toEqual({
      conversationId: scope.conversationId,
      generation: 1,
      shouldStart: true,
    });
    expect(secondEnsure).toEqual({
      conversationId: scope.conversationId,
      generation: 1,
      shouldStart: false,
    });

    await env.controlPlaneDb
      .update(env.controlPlaneTables.triggerConversationDeliveryProcessors)
      .set({
        status: TriggerConversationDeliveryProcessorStatuses.IDLE,
        activeWorkflowRunId: null,
      })
      .where(
        eq(
          env.controlPlaneTables.triggerConversationDeliveryProcessors.conversationId,
          scope.conversationId,
        ),
      );

    const thirdEnsure = await ensureTriggerConversationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
      },
    );

    expect(thirdEnsure).toEqual({
      conversationId: scope.conversationId,
      generation: 2,
      shouldStart: true,
    });

    const processor =
      await env.controlPlaneDb.query.triggerConversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, scope.conversationId),
      });
    expect(processor).toEqual(
      expect.objectContaining({
        conversationId: scope.conversationId,
        generation: 2,
        status: TriggerConversationDeliveryProcessorStatuses.RUNNING,
        activeWorkflowRunId: null,
      }),
    );
  });

  it("claims the next queued delivery task in source order", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("claim_next"),
    });
    const laterTask = await createQueuedDeliveryTask({
      env,
      scope,
      suffix: createSuffix("claim_next_later"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0002",
    });
    const earlierTask = await createQueuedDeliveryTask({
      env,
      scope,
      suffix: createSuffix("claim_next_earlier"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });

    const claimedTask = await claimNextTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 3,
      },
    );

    expect(claimedTask).toEqual(
      expect.objectContaining({
        id: earlierTask.id,
        status: TriggerConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 3,
        attemptCount: 1,
      }),
    );
    expect(claimedTask?.claimedAt).not.toBeNull();

    const persistedLaterTask =
      await env.controlPlaneDb.query.triggerConversationDeliveryTasks.findFirst({
        where: (table, { eq }) => eq(table.id, laterTask.id),
      });
    expect(persistedLaterTask?.status).toBe(TriggerConversationDeliveryTaskStatuses.QUEUED);
  });

  it("marks a claimed task delivering and finalizes it terminally", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("finalize_task"),
    });
    const task = await createQueuedDeliveryTask({
      env,
      scope,
      suffix: createSuffix("finalize_task"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });
    const claimedTask = await claimNextTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 2,
      },
    );
    expect(claimedTask?.id).toBe(task.id);

    const deliveringTask = await markTriggerConversationDeliveryTaskDelivering(
      { db: env.controlPlaneDb },
      {
        taskId: task.id,
        generation: 2,
      },
    );

    expect(deliveringTask.status).toBe(TriggerConversationDeliveryTaskStatuses.DELIVERING);
    expect(deliveringTask.deliveryStartedAt).not.toBeNull();

    const finalizedTask = await finalizeTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        taskId: deliveringTask.id,
        generation: 2,
        status: TriggerConversationDeliveryTaskStatuses.FAILED,
        failureCode: "delivery_failed",
        failureMessage: "Delivery failed for testing.",
      },
    );

    expect(finalizedTask.status).toBe(TriggerConversationDeliveryTaskStatuses.FAILED);
    expect(finalizedTask.failureCode).toBe("delivery_failed");
    expect(finalizedTask.failureMessage).toBe("Delivery failed for testing.");
    expect(finalizedTask.finishedAt).not.toBeNull();

    await expect(
      finalizeTriggerConversationDeliveryTask(
        { db: env.controlPlaneDb },
        {
          taskId: deliveringTask.id,
          generation: 2,
          status: TriggerConversationDeliveryTaskStatuses.COMPLETED,
        },
      ),
    ).rejects.toMatchObject({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
    });
  });

  it("updates the conversation high-water mark when delivery completes", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("complete_high_water"),
    });
    const task = await createQueuedDeliveryTask({
      env,
      scope,
      suffix: createSuffix("complete_high_water"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0005",
    });
    const claimedTask = await claimNextTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 9,
      },
    );
    expect(claimedTask?.id).toBe(task.id);

    await markTriggerConversationDeliveryTaskDelivering(
      { db: env.controlPlaneDb },
      {
        taskId: task.id,
        generation: 9,
      },
    );

    const completedTask = await finalizeTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        taskId: task.id,
        generation: 9,
        status: TriggerConversationDeliveryTaskStatuses.COMPLETED,
      },
    );
    const conversation = await env.controlPlaneDb.query.triggerConversations.findFirst({
      where: (table, { eq }) => eq(table.id, scope.conversationId),
    });

    expect(completedTask.status).toBe(TriggerConversationDeliveryTaskStatuses.COMPLETED);
    expect(conversation).toEqual(
      expect.objectContaining({
        id: scope.conversationId,
        lastProcessedSourceOrderKey: "2026-03-09T00:00:00Z#0005",
        lastProcessedWebhookEventId: task.webhookEventId,
      }),
    );
  });

  it("ignores stale tasks behind the conversation high-water mark", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("stale_action"),
    });
    const task = await createQueuedDeliveryTask({
      env,
      scope,
      suffix: createSuffix("stale_action"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });

    await env.controlPlaneDb
      .update(env.controlPlaneTables.triggerConversations)
      .set({
        lastProcessedSourceOrderKey: "2026-03-09T00:00:00Z#0002",
        lastProcessedWebhookEventId: task.webhookEventId,
      })
      .where(eq(env.controlPlaneTables.triggerConversations.id, scope.conversationId));
    await env.controlPlaneDb
      .update(env.controlPlaneTables.triggerConversationDeliveryTasks)
      .set({
        status: TriggerConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 11,
        attemptCount: 1,
        claimedAt: "2026-03-09T00:00:01.000Z",
      })
      .where(eq(env.controlPlaneTables.triggerConversationDeliveryTasks.id, task.id));

    const action = await resolveTriggerConversationDeliveryTaskAction(
      { db: env.controlPlaneDb },
      {
        taskId: task.id,
        generation: 11,
      },
    );

    expect(action).toBe("ignore");
  });

  it("keeps the processor running while active tasks still exist", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("idle_active"),
    });
    const task = await createQueuedDeliveryTask({
      env,
      scope,
      suffix: createSuffix("idle_active"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });

    await env.controlPlaneDb
      .insert(env.controlPlaneTables.triggerConversationDeliveryProcessors)
      .values({
        conversationId: scope.conversationId,
        generation: 4,
        status: TriggerConversationDeliveryProcessorStatuses.RUNNING,
        activeWorkflowRunId: null,
      })
      .onConflictDoNothing();
    await env.controlPlaneDb
      .update(env.controlPlaneTables.triggerConversationDeliveryTasks)
      .set({
        status: TriggerConversationDeliveryTaskStatuses.DELIVERING,
        processorGeneration: 4,
        attemptCount: 1,
        claimedAt: "2026-03-09T00:00:01.000Z",
        deliveryStartedAt: "2026-03-09T00:00:02.000Z",
      })
      .where(eq(env.controlPlaneTables.triggerConversationDeliveryTasks.id, task.id));

    const didIdle = await idleTriggerConversationDeliveryProcessorIfEmpty(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 4,
      },
    );

    expect(didIdle).toBe(false);

    const processor =
      await env.controlPlaneDb.query.triggerConversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, scope.conversationId),
      });
    expect(processor?.status).toBe(TriggerConversationDeliveryProcessorStatuses.RUNNING);
  });

  it("resumes the active task claimed by the current processor generation", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("resume_active"),
    });
    const task = await createQueuedDeliveryTask({
      env,
      scope,
      suffix: createSuffix("resume_active"),
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });

    await env.controlPlaneDb
      .update(env.controlPlaneTables.triggerConversationDeliveryTasks)
      .set({
        status: TriggerConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 7,
        attemptCount: 1,
        claimedAt: "2026-03-09T00:00:01.000Z",
      })
      .where(eq(env.controlPlaneTables.triggerConversationDeliveryTasks.id, task.id));

    const activeTask = await findActiveTriggerConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 7,
      },
    );

    expect(activeTask).toEqual(
      expect.objectContaining({
        id: task.id,
        status: TriggerConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 7,
      }),
    );
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

async function seedConversationDeliveryScope(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
}): Promise<ConversationDeliveryScope> {
  const organizationId = `org_cdt_${input.suffix}`;
  const sandboxProfileId = `sbp_cdt_${input.suffix}`;
  const triggerId = `atm_cdt_${input.suffix}`;
  const triggerTargetId = `atg_cdt_${input.suffix}`;
  const integrationConnectionId = `icn_cdt_${input.suffix}`;
  const integrationWebhookSourceId = `iws_cdt_${input.suffix}`;
  const targetKey = `github_cloud_cdt_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Trigger Conversation Delivery ${input.suffix}`,
    slug: `conversation-delivery-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Trigger Conversation Delivery ${input.suffix}`,
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
      displayName: `Trigger Conversation Delivery ${input.suffix}`,
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
    name: `Trigger Conversation Delivery ${input.suffix}`,
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

async function createQueuedDeliveryTask(input: {
  env: IntegrationTestEnvironment;
  scope: ConversationDeliveryScope;
  suffix: string;
  sourceOrderKey: string;
}): Promise<{
  id: string;
  triggerRunId: string;
  webhookEventId: string;
}> {
  const webhookEventId = await insertWebhookEvent({
    env: input.env,
    scope: input.scope,
    suffix: input.suffix,
    sourceOrderKey: input.sourceOrderKey,
  });
  const triggerRunId = await insertTriggerRun({
    env: input.env,
    scope: input.scope,
    webhookEventId,
    suffix: input.suffix,
  });

  const task = await enqueueTriggerConversationDeliveryTask(
    { db: input.env.controlPlaneDb },
    {
      conversationId: input.scope.conversationId,
      triggerRunId,
      sourceWebhookEventId: webhookEventId,
      sourceOrderKey: input.sourceOrderKey,
    },
  );

  return {
    id: task.id,
    triggerRunId,
    webhookEventId,
  };
}

async function insertWebhookEvent(input: {
  env: IntegrationTestEnvironment;
  scope: ConversationDeliveryScope;
  suffix: string;
  sourceOrderKey: string;
}): Promise<string> {
  const webhookEventId = `iwe_cdt_${input.suffix}`;

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
  const triggerRunId = `aru_cdt_${input.suffix}`;

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
