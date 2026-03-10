import {
  automationRuns,
  AutomationRunStatuses,
  automationTargets,
  automations,
  AutomationKinds,
  automationConversationDeliveryProcessors,
  automationConversationDeliveryTasks,
  AutomationConversationDeliveryProcessorStatuses,
  AutomationConversationDeliveryTaskStatuses,
  AutomationConversationCreatedByKinds,
  automationConversations,
  AutomationConversationOwnerKinds,
  createControlPlaneDatabase,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
  organizations,
  sandboxProfiles,
  CONTROL_PLANE_SCHEMA_NAME,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  claimAutomationConversation,
  claimNextAutomationConversationDeliveryTask,
  AutomationConversationPersistenceErrorCodes,
  ensureAutomationConversationDeliveryProcessor,
  enqueueAutomationConversationDeliveryTask,
  finalizeAutomationConversationDeliveryTask,
  findActiveAutomationConversationDeliveryTask,
  idleAutomationConversationDeliveryProcessorIfEmpty,
  markAutomationConversationDeliveryTaskDelivering,
  resolveAutomationConversationDeliveryTaskAction,
} from "../src/runtime/automation-workflows/persistence/index.js";
import { it } from "./test-context.js";

async function createTestDatabase(input: { databaseUrl: string }) {
  await runControlPlaneMigrations({
    connectionString: input.databaseUrl,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  const pool = new Pool({
    connectionString: input.databaseUrl,
  });
  const db = createControlPlaneDatabase(pool);

  return {
    db,
    stop: async () => {
      await pool.end();
    },
  };
}

async function seedConversationDeliveryScope(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  suffix: string;
}) {
  const organizationId = `org_cdt_${input.suffix}`;
  const sandboxProfileId = `sbp_cdt_${input.suffix}`;
  const automationId = `atm_cdt_${input.suffix}`;
  const automationTargetId = `atg_cdt_${input.suffix}`;
  const integrationConnectionId = `icn_cdt_${input.suffix}`;
  const targetKey = `github-cloud-cdt-${input.suffix}`;

  await input.db.insert(organizations).values({
    id: organizationId,
    name: `AutomationConversation Delivery ${input.suffix}`,
    slug: `conversation-delivery-${input.suffix}`,
  });
  await input.db.insert(sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `AutomationConversation Delivery ${input.suffix}`,
    status: "active",
  });
  await input.db.insert(integrationTargets).values({
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.db.insert(integrationConnections).values({
    id: integrationConnectionId,
    organizationId,
    targetKey,
    displayName: `AutomationConversation Delivery ${input.suffix}`,
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: `subject-${input.suffix}`,
    config: {},
  });
  await input.db.insert(automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `AutomationConversation Delivery ${input.suffix}`,
    enabled: true,
  });
  await input.db.insert(automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });

  const conversation = await claimAutomationConversation(
    { db: input.db },
    {
      organizationId,
      ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
      ownerId: automationTargetId,
      createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
      createdById: automationId,
      conversationKey: `conversation-${input.suffix}`,
      sandboxProfileId,
      integrationFamilyId: "openai",
      preview: "AutomationConversation delivery test",
    },
  );

  return {
    organizationId,
    sandboxProfileId,
    automationId,
    automationTargetId,
    integrationConnectionId,
    targetKey,
    conversationId: conversation.id,
  };
}

async function insertWebhookEvent(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  organizationId: string;
  integrationConnectionId: string;
  targetKey: string;
  suffix: string;
  sourceOrderKey: string;
}) {
  const webhookEventId = `iwe_cdt_${input.suffix}`;

  await input.db.insert(integrationWebhookEvents).values({
    id: webhookEventId,
    organizationId: input.organizationId,
    integrationConnectionId: input.integrationConnectionId,
    targetKey: input.targetKey,
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
    status: IntegrationWebhookEventStatuses.PROCESSED,
  });

  return webhookEventId;
}

async function insertAutomationRun(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  automationId: string;
  automationTargetId: string;
  conversationId: string;
  webhookEventId: string;
  suffix: string;
}) {
  const automationRunId = `aru_cdt_${input.suffix}`;

  await input.db.insert(automationRuns).values({
    id: automationRunId,
    automationId: input.automationId,
    automationTargetId: input.automationTargetId,
    conversationId: input.conversationId,
    sourceWebhookEventId: input.webhookEventId,
    renderedInput: `input-${input.suffix}`,
    renderedConversationKey: `conversation-${input.suffix}`,
    status: AutomationRunStatuses.RUNNING,
  });

  return automationRunId;
}

describe("conversation delivery persistence integration", () => {
  it("enqueues one delivery task per automation run and reuses the existing row", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "enqueue-idempotent",
      });
      const webhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "enqueue-idempotent",
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const automationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId,
        suffix: "enqueue-idempotent",
      });

      const firstTask = await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );
      const secondTask = await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      expect(secondTask.id).toBe(firstTask.id);

      const persistedTasks = await database.db.query.automationConversationDeliveryTasks.findMany({
        where: (table, { eq }) => eq(table.automationRunId, automationRunId),
      });
      expect(persistedTasks).toHaveLength(1);
      expect(persistedTasks[0]?.status).toBe("queued");
    } finally {
      await database.stop();
    }
  });

  it("rejects enqueueing a conflicting task for the same automation run", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "enqueue-mismatch",
      });
      const webhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "enqueue-mismatch",
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const automationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId,
        suffix: "enqueue-mismatch",
      });

      await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      await expect(
        enqueueAutomationConversationDeliveryTask(
          { db: database.db },
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
    } finally {
      await database.stop();
    }
  });

  it("starts a processor once and reuses it until it returns to idle", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "ensure-processor",
      });

      const firstEnsure = await ensureAutomationConversationDeliveryProcessor(
        { db: database.db },
        {
          conversationId: scope.conversationId,
        },
      );
      const secondEnsure = await ensureAutomationConversationDeliveryProcessor(
        { db: database.db },
        {
          conversationId: scope.conversationId,
        },
      );

      expect(firstEnsure.shouldStart).toBe(true);
      expect(firstEnsure.generation).toBe(1);
      expect(secondEnsure.shouldStart).toBe(false);
      expect(secondEnsure.generation).toBe(1);

      await database.db
        .update(automationConversationDeliveryProcessors)
        .set({
          status: AutomationConversationDeliveryProcessorStatuses.IDLE,
          activeWorkflowRunId: null,
          updatedAt: "2026-03-09T00:00:00.000Z",
        })
        .where(eq(automationConversationDeliveryProcessors.conversationId, scope.conversationId));

      const thirdEnsure = await ensureAutomationConversationDeliveryProcessor(
        { db: database.db },
        {
          conversationId: scope.conversationId,
        },
      );

      expect(thirdEnsure.shouldStart).toBe(true);
      expect(thirdEnsure.generation).toBe(2);

      const persistedProcessor =
        await database.db.query.automationConversationDeliveryProcessors.findFirst({
          where: (table, { eq }) => eq(table.conversationId, scope.conversationId),
        });
      expect(persistedProcessor).toMatchObject({
        conversationId: scope.conversationId,
        generation: 2,
        status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
        activeWorkflowRunId: null,
      });
    } finally {
      await database.stop();
    }
  });

  it("claims the next queued delivery task in source order and marks it claimed", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "claim-next",
      });
      const firstWebhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "claim-next-first",
        sourceOrderKey: "2026-03-09T00:00:00Z#0002",
      });
      const secondWebhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "claim-next-second",
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const firstAutomationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId: firstWebhookEventId,
        suffix: "claim-next-first",
      });
      const secondAutomationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId: secondWebhookEventId,
        suffix: "claim-next-second",
      });

      await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId: firstAutomationRunId,
          sourceWebhookEventId: firstWebhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0002",
        },
      );
      const secondTask = await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId: secondAutomationRunId,
          sourceWebhookEventId: secondWebhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      const claimedTask = await claimNextAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          generation: 3,
        },
      );

      expect(claimedTask?.id).toBe(secondTask.id);
      expect(claimedTask?.status).toBe(AutomationConversationDeliveryTaskStatuses.CLAIMED);
      expect(claimedTask?.processorGeneration).toBe(3);
      expect(claimedTask?.attemptCount).toBe(1);
      expect(claimedTask?.claimedAt).not.toBeNull();

      const persistedFirstTask =
        await database.db.query.automationConversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.automationRunId, firstAutomationRunId),
        });
      expect(persistedFirstTask?.status).toBe(AutomationConversationDeliveryTaskStatuses.QUEUED);
    } finally {
      await database.stop();
    }
  });

  it("marks a claimed task delivering and then finalizes it with a terminal status", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "finalize-task",
      });
      const webhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "finalize-task",
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const automationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId,
        suffix: "finalize-task",
      });

      await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );
      const claimedTask = await claimNextAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          generation: 2,
        },
      );
      if (claimedTask === null) {
        throw new Error("Expected a claimed conversation delivery task.");
      }

      const deliveringTask = await markAutomationConversationDeliveryTaskDelivering(
        { db: database.db },
        {
          taskId: claimedTask.id,
          generation: 2,
        },
      );

      expect(deliveringTask.status).toBe(AutomationConversationDeliveryTaskStatuses.DELIVERING);
      expect(deliveringTask.deliveryStartedAt).not.toBeNull();

      const finalizedTask = await finalizeAutomationConversationDeliveryTask(
        { db: database.db },
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
          { db: database.db },
          {
            taskId: deliveringTask.id,
            generation: 2,
            status: AutomationConversationDeliveryTaskStatuses.COMPLETED,
          },
        ),
      ).rejects.toMatchObject({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      });
    } finally {
      await database.stop();
    }
  });

  it("updates the conversation high-water mark when a task completes", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "complete-high-water",
      });
      const webhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "complete-high-water",
        sourceOrderKey: "2026-03-09T00:00:00Z#0005",
      });
      const automationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId,
        suffix: "complete-high-water",
      });

      await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0005",
        },
      );
      const claimedTask = await claimNextAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          generation: 9,
        },
      );
      if (claimedTask === null) {
        throw new Error("Expected a claimed conversation delivery task.");
      }

      await markAutomationConversationDeliveryTaskDelivering(
        { db: database.db },
        {
          taskId: claimedTask.id,
          generation: 9,
        },
      );

      const completedTask = await finalizeAutomationConversationDeliveryTask(
        { db: database.db },
        {
          taskId: claimedTask.id,
          generation: 9,
          status: AutomationConversationDeliveryTaskStatuses.COMPLETED,
        },
      );
      const conversation = await database.db.query.automationConversations.findFirst({
        where: (table, { eq }) => eq(table.id, scope.conversationId),
      });

      expect(completedTask.status).toBe(AutomationConversationDeliveryTaskStatuses.COMPLETED);
      expect(conversation).toMatchObject({
        id: scope.conversationId,
        lastProcessedSourceOrderKey: "2026-03-09T00:00:00Z#0005",
        lastProcessedWebhookEventId: webhookEventId,
      });
    } finally {
      await database.stop();
    }
  });

  it("returns ignore when a task is stale against the conversation high-water mark", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "stale-action",
      });
      const webhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "stale-action",
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const automationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId,
        suffix: "stale-action",
      });

      await database.db
        .update(automationConversations)
        .set({
          lastProcessedSourceOrderKey: "2026-03-09T00:00:00Z#0002",
          lastProcessedWebhookEventId: webhookEventId,
        })
        .where(eq(automationConversations.id, scope.conversationId));

      const task = await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );
      await database.db
        .update(automationConversationDeliveryTasks)
        .set({
          status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
          processorGeneration: 11,
          attemptCount: 1,
          claimedAt: "2026-03-09T00:00:01.000Z",
          updatedAt: "2026-03-09T00:00:01.000Z",
        })
        .where(eq(automationConversationDeliveryTasks.id, task.id));

      const action = await resolveAutomationConversationDeliveryTaskAction(
        { db: database.db },
        {
          taskId: task.id,
          generation: 11,
        },
      );

      expect(action).toBe("ignore");
    } finally {
      await database.stop();
    }
  });

  it("resumes the active task claimed by the current processor generation", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "resume-active",
      });
      const webhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "resume-active",
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const automationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId,
        suffix: "resume-active",
      });

      const task = await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      await database.db
        .update(automationConversationDeliveryTasks)
        .set({
          status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
          processorGeneration: 7,
          attemptCount: 1,
          claimedAt: "2026-03-09T00:00:01.000Z",
          updatedAt: "2026-03-09T00:00:01.000Z",
        })
        .where(eq(automationConversationDeliveryTasks.id, task.id));

      const activeTask = await findActiveAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          generation: 7,
        },
      );

      expect(activeTask).toMatchObject({
        id: task.id,
        status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: 7,
      });
    } finally {
      await database.stop();
    }
  });

  it("does not idle the processor while claimed or delivering tasks still exist", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationDeliveryScope({
        db: database.db,
        suffix: "idle-active",
      });
      const webhookEventId = await insertWebhookEvent({
        db: database.db,
        organizationId: scope.organizationId,
        integrationConnectionId: scope.integrationConnectionId,
        targetKey: scope.targetKey,
        suffix: "idle-active",
        sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      });
      const automationRunId = await insertAutomationRun({
        db: database.db,
        automationId: scope.automationId,
        automationTargetId: scope.automationTargetId,
        conversationId: scope.conversationId,
        webhookEventId,
        suffix: "idle-active",
      });

      const task = await enqueueAutomationConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      await database.db
        .insert(automationConversationDeliveryProcessors)
        .values({
          conversationId: scope.conversationId,
          generation: 4,
          status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
          activeWorkflowRunId: null,
        })
        .onConflictDoNothing();

      await database.db
        .update(automationConversationDeliveryTasks)
        .set({
          status: AutomationConversationDeliveryTaskStatuses.DELIVERING,
          processorGeneration: 4,
          attemptCount: 1,
          claimedAt: "2026-03-09T00:00:01.000Z",
          deliveryStartedAt: "2026-03-09T00:00:02.000Z",
          updatedAt: "2026-03-09T00:00:02.000Z",
        })
        .where(eq(automationConversationDeliveryTasks.id, task.id));

      const didIdle = await idleAutomationConversationDeliveryProcessorIfEmpty(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          generation: 4,
        },
      );

      expect(didIdle).toBe(false);

      const processor = await database.db.query.automationConversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, scope.conversationId),
      });
      expect(processor?.status).toBe(AutomationConversationDeliveryProcessorStatuses.RUNNING);
    } finally {
      await database.stop();
    }
  });
});
