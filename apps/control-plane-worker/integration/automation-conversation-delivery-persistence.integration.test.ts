/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  AutomationConversationCreatedByKinds,
  AutomationConversationDeliveryProcessorStatuses,
  AutomationConversationDeliveryTaskStatuses,
  AutomationConversationOwnerKinds,
  AutomationKinds,
  AutomationRunStatuses,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { finalizeAutomationConversationDeliveryTask } from "../openworkflow/handle-automation-conversation-delivery/finalize-automation-conversation-delivery-task.js";
import { idleAutomationConversationDeliveryProcessorIfEmpty } from "../openworkflow/handle-automation-conversation-delivery/idle-automation-conversation-delivery-processor-if-empty.js";
import { resolveAutomationConversationDeliveryTaskAction } from "../openworkflow/handle-automation-conversation-delivery/resolve-automation-conversation-delivery-task-action.js";
import { AutomationConversationPersistenceErrorCodes } from "../openworkflow/shared/automation-conversation-persistence-error.js";
import { claimAutomationConversation } from "../openworkflow/shared/claim-conversation.js";
import { claimNextAutomationConversationDeliveryTask } from "../openworkflow/shared/claim-next-conversation-delivery-task.js";
import { enqueueAutomationConversationDeliveryTask } from "../openworkflow/shared/enqueue-conversation-delivery-task.js";
import { ensureAutomationConversationDeliveryProcessor } from "../openworkflow/shared/ensure-conversation-delivery-processor.js";
import { findActiveAutomationConversationDeliveryTask } from "../openworkflow/shared/find-active-conversation-delivery-task.js";
import { markAutomationConversationDeliveryTaskDelivering } from "../openworkflow/shared/mark-conversation-delivery-task-delivering.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

describe.concurrent("control-plane worker conversation delivery persistence", () => {
  it("enqueues one delivery task per automation run and reuses the existing row", async ({
    env,
  }) => {
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
    const automationRunId = await insertAutomationRun({
      env,
      scope,
      webhookEventId,
      suffix: createSuffix("enqueue_idempotent_run"),
    });

    const firstTask = await enqueueAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        automationRunId,
        sourceWebhookEventId: webhookEventId,
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      },
    );
    const secondTask = await enqueueAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        automationRunId,
        sourceWebhookEventId: webhookEventId,
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      },
    );

    expect(secondTask.id).toBe(firstTask.id);

    const persistedTasks =
      await env.controlPlaneDb.query.automationConversationDeliveryTasks.findMany({
        where: (table, { eq }) => eq(table.automationRunId, automationRunId),
      });
    expect(persistedTasks).toHaveLength(1);
    expect(persistedTasks[0]?.status).toBe(AutomationConversationDeliveryTaskStatuses.QUEUED);
  });

  it("rejects conflicting task input for the same automation run", async ({ env }) => {
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
    const automationRunId = await insertAutomationRun({
      env,
      scope,
      webhookEventId,
      suffix: createSuffix("enqueue_mismatch_run"),
    });

    await enqueueAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        automationRunId,
        sourceWebhookEventId: webhookEventId,
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      },
    );

    await expect(
      enqueueAutomationConversationDeliveryTask(
        { db: env.controlPlaneDb },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0002",
        },
      ),
    ).rejects.toMatchObject({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
    });
  });

  it("starts one delivery processor and reuses it until it returns to idle", async ({ env }) => {
    const scope = await seedConversationDeliveryScope({
      env,
      suffix: createSuffix("ensure_processor"),
    });

    const firstEnsure = await ensureAutomationConversationDeliveryProcessor(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
      },
    );
    const secondEnsure = await ensureAutomationConversationDeliveryProcessor(
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
      .update(env.controlPlaneTables.automationConversationDeliveryProcessors)
      .set({
        status: AutomationConversationDeliveryProcessorStatuses.IDLE,
        activeWorkflowRunId: null,
      })
      .where(
        eq(
          env.controlPlaneTables.automationConversationDeliveryProcessors.conversationId,
          scope.conversationId,
        ),
      );

    const thirdEnsure = await ensureAutomationConversationDeliveryProcessor(
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
      await env.controlPlaneDb.query.automationConversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, scope.conversationId),
      });
    expect(processor).toEqual(
      expect.objectContaining({
        conversationId: scope.conversationId,
        generation: 2,
        status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
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

    const claimedTask = await claimNextAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 3,
      },
    );

    expect(claimedTask).toEqual(
      expect.objectContaining({
        id: earlierTask.id,
        status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 3,
        attemptCount: 1,
      }),
    );
    expect(claimedTask?.claimedAt).not.toBeNull();

    const persistedLaterTask =
      await env.controlPlaneDb.query.automationConversationDeliveryTasks.findFirst({
        where: (table, { eq }) => eq(table.id, laterTask.id),
      });
    expect(persistedLaterTask?.status).toBe(AutomationConversationDeliveryTaskStatuses.QUEUED);
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
    const claimedTask = await claimNextAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 2,
      },
    );
    expect(claimedTask?.id).toBe(task.id);

    const deliveringTask = await markAutomationConversationDeliveryTaskDelivering(
      { db: env.controlPlaneDb },
      {
        taskId: task.id,
        generation: 2,
      },
    );

    expect(deliveringTask.status).toBe(AutomationConversationDeliveryTaskStatuses.DELIVERING);
    expect(deliveringTask.deliveryStartedAt).not.toBeNull();

    const finalizedTask = await finalizeAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        taskId: deliveringTask.id,
        generation: 2,
        status: AutomationConversationDeliveryTaskStatuses.FAILED,
        failureCode: "delivery_failed",
        failureMessage: "Delivery failed for testing.",
      },
    );

    expect(finalizedTask.status).toBe(AutomationConversationDeliveryTaskStatuses.FAILED);
    expect(finalizedTask.failureCode).toBe("delivery_failed");
    expect(finalizedTask.failureMessage).toBe("Delivery failed for testing.");
    expect(finalizedTask.finishedAt).not.toBeNull();

    await expect(
      finalizeAutomationConversationDeliveryTask(
        { db: env.controlPlaneDb },
        {
          taskId: deliveringTask.id,
          generation: 2,
          status: AutomationConversationDeliveryTaskStatuses.COMPLETED,
        },
      ),
    ).rejects.toMatchObject({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
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
    const claimedTask = await claimNextAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 9,
      },
    );
    expect(claimedTask?.id).toBe(task.id);

    await markAutomationConversationDeliveryTaskDelivering(
      { db: env.controlPlaneDb },
      {
        taskId: task.id,
        generation: 9,
      },
    );

    const completedTask = await finalizeAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        taskId: task.id,
        generation: 9,
        status: AutomationConversationDeliveryTaskStatuses.COMPLETED,
      },
    );
    const conversation = await env.controlPlaneDb.query.automationConversations.findFirst({
      where: (table, { eq }) => eq(table.id, scope.conversationId),
    });

    expect(completedTask.status).toBe(AutomationConversationDeliveryTaskStatuses.COMPLETED);
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
      .update(env.controlPlaneTables.automationConversations)
      .set({
        lastProcessedSourceOrderKey: "2026-03-09T00:00:00Z#0002",
        lastProcessedWebhookEventId: task.webhookEventId,
      })
      .where(eq(env.controlPlaneTables.automationConversations.id, scope.conversationId));
    await env.controlPlaneDb
      .update(env.controlPlaneTables.automationConversationDeliveryTasks)
      .set({
        status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 11,
        attemptCount: 1,
        claimedAt: "2026-03-09T00:00:01.000Z",
      })
      .where(eq(env.controlPlaneTables.automationConversationDeliveryTasks.id, task.id));

    const action = await resolveAutomationConversationDeliveryTaskAction(
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
      .insert(env.controlPlaneTables.automationConversationDeliveryProcessors)
      .values({
        conversationId: scope.conversationId,
        generation: 4,
        status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
        activeWorkflowRunId: null,
      })
      .onConflictDoNothing();
    await env.controlPlaneDb
      .update(env.controlPlaneTables.automationConversationDeliveryTasks)
      .set({
        status: AutomationConversationDeliveryTaskStatuses.DELIVERING,
        processorGeneration: 4,
        attemptCount: 1,
        claimedAt: "2026-03-09T00:00:01.000Z",
        deliveryStartedAt: "2026-03-09T00:00:02.000Z",
      })
      .where(eq(env.controlPlaneTables.automationConversationDeliveryTasks.id, task.id));

    const didIdle = await idleAutomationConversationDeliveryProcessorIfEmpty(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 4,
      },
    );

    expect(didIdle).toBe(false);

    const processor =
      await env.controlPlaneDb.query.automationConversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, scope.conversationId),
      });
    expect(processor?.status).toBe(AutomationConversationDeliveryProcessorStatuses.RUNNING);
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
      .update(env.controlPlaneTables.automationConversationDeliveryTasks)
      .set({
        status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 7,
        attemptCount: 1,
        claimedAt: "2026-03-09T00:00:01.000Z",
      })
      .where(eq(env.controlPlaneTables.automationConversationDeliveryTasks.id, task.id));

    const activeTask = await findActiveAutomationConversationDeliveryTask(
      { db: env.controlPlaneDb },
      {
        conversationId: scope.conversationId,
        generation: 7,
      },
    );

    expect(activeTask).toEqual(
      expect.objectContaining({
        id: task.id,
        status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 7,
      }),
    );
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

async function seedConversationDeliveryScope(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
}): Promise<ConversationDeliveryScope> {
  const organizationId = `org_cdt_${input.suffix}`;
  const sandboxProfileId = `sbp_cdt_${input.suffix}`;
  const automationId = `atm_cdt_${input.suffix}`;
  const automationTargetId = `atg_cdt_${input.suffix}`;
  const integrationConnectionId = `icn_cdt_${input.suffix}`;
  const integrationWebhookSourceId = `iws_cdt_${input.suffix}`;
  const targetKey = `github_cloud_cdt_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Automation Conversation Delivery ${input.suffix}`,
    slug: `conversation-delivery-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Automation Conversation Delivery ${input.suffix}`,
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
      displayName: `Automation Conversation Delivery ${input.suffix}`,
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
    name: `Automation Conversation Delivery ${input.suffix}`,
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

async function createQueuedDeliveryTask(input: {
  env: IntegrationTestEnvironment;
  scope: ConversationDeliveryScope;
  suffix: string;
  sourceOrderKey: string;
}): Promise<{
  id: string;
  automationRunId: string;
  webhookEventId: string;
}> {
  const webhookEventId = await insertWebhookEvent({
    env: input.env,
    scope: input.scope,
    suffix: input.suffix,
    sourceOrderKey: input.sourceOrderKey,
  });
  const automationRunId = await insertAutomationRun({
    env: input.env,
    scope: input.scope,
    webhookEventId,
    suffix: input.suffix,
  });

  const task = await enqueueAutomationConversationDeliveryTask(
    { db: input.env.controlPlaneDb },
    {
      conversationId: input.scope.conversationId,
      automationRunId,
      sourceWebhookEventId: webhookEventId,
      sourceOrderKey: input.sourceOrderKey,
    },
  );

  return {
    id: task.id,
    automationRunId,
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

async function insertAutomationRun(input: {
  env: IntegrationTestEnvironment;
  scope: ConversationDeliveryScope;
  webhookEventId: string;
  suffix: string;
}): Promise<string> {
  const automationRunId = `aru_cdt_${input.suffix}`;

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
