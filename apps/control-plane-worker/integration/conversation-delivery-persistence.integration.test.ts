import {
  automationRuns,
  AutomationRunStatuses,
  automationTargets,
  automations,
  AutomationKinds,
  conversationDeliveryProcessors,
  ConversationDeliveryProcessorStatuses,
  ConversationDeliveryTaskStatuses,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
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
  claimConversation,
  claimNextConversationDeliveryTask,
  ConversationPersistenceErrorCodes,
  ensureConversationDeliveryProcessor,
  enqueueConversationDeliveryTask,
  finalizeConversationDeliveryTask,
} from "../src/runtime/conversations/index.js";
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
    name: `Conversation Delivery ${input.suffix}`,
    slug: `conversation-delivery-${input.suffix}`,
  });
  await input.db.insert(sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Conversation Delivery ${input.suffix}`,
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
    displayName: `Conversation Delivery ${input.suffix}`,
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: `subject-${input.suffix}`,
    config: {},
  });
  await input.db.insert(automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Conversation Delivery ${input.suffix}`,
    enabled: true,
  });
  await input.db.insert(automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });

  const conversation = await claimConversation(
    { db: input.db },
    {
      organizationId,
      ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
      ownerId: automationTargetId,
      createdByKind: ConversationCreatedByKinds.WEBHOOK,
      createdById: automationId,
      conversationKey: `conversation-${input.suffix}`,
      sandboxProfileId,
      integrationFamilyId: "openai",
      preview: "Conversation delivery test",
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

      const firstTask = await enqueueConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );
      const secondTask = await enqueueConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      expect(secondTask.id).toBe(firstTask.id);

      const persistedTasks = await database.db.query.conversationDeliveryTasks.findMany({
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

      await enqueueConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      await expect(
        enqueueConversationDeliveryTask(
          { db: database.db },
          {
            conversationId: scope.conversationId,
            automationRunId,
            sourceWebhookEventId: webhookEventId,
            sourceOrderKey: "2026-03-09T00:00:00Z#0002",
          },
        ),
      ).rejects.toMatchObject({
        code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
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

      const firstEnsure = await ensureConversationDeliveryProcessor(
        { db: database.db },
        {
          conversationId: scope.conversationId,
        },
      );
      const secondEnsure = await ensureConversationDeliveryProcessor(
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
        .update(conversationDeliveryProcessors)
        .set({
          status: ConversationDeliveryProcessorStatuses.IDLE,
          activeWorkflowRunId: null,
          updatedAt: "2026-03-09T00:00:00.000Z",
        })
        .where(eq(conversationDeliveryProcessors.conversationId, scope.conversationId));

      const thirdEnsure = await ensureConversationDeliveryProcessor(
        { db: database.db },
        {
          conversationId: scope.conversationId,
        },
      );

      expect(thirdEnsure.shouldStart).toBe(true);
      expect(thirdEnsure.generation).toBe(2);

      const persistedProcessor = await database.db.query.conversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, scope.conversationId),
      });
      expect(persistedProcessor).toMatchObject({
        conversationId: scope.conversationId,
        generation: 2,
        status: ConversationDeliveryProcessorStatuses.RUNNING,
        activeWorkflowRunId: null,
      });
    } finally {
      await database.stop();
    }
  });

  it("claims the next queued delivery task in source order and marks it processing", async ({
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

      await enqueueConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId: firstAutomationRunId,
          sourceWebhookEventId: firstWebhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0002",
        },
      );
      const secondTask = await enqueueConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId: secondAutomationRunId,
          sourceWebhookEventId: secondWebhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );

      const claimedTask = await claimNextConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
        },
      );

      expect(claimedTask?.id).toBe(secondTask.id);
      expect(claimedTask?.status).toBe(ConversationDeliveryTaskStatuses.PROCESSING);
      expect(claimedTask?.startedAt).not.toBeNull();

      const persistedFirstTask = await database.db.query.conversationDeliveryTasks.findFirst({
        where: (table, { eq }) => eq(table.automationRunId, firstAutomationRunId),
      });
      expect(persistedFirstTask?.status).toBe(ConversationDeliveryTaskStatuses.QUEUED);
    } finally {
      await database.stop();
    }
  });

  it("finalizes a processing delivery task with terminal status and timestamps", async ({
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

      await enqueueConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
          automationRunId,
          sourceWebhookEventId: webhookEventId,
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
        },
      );
      const claimedTask = await claimNextConversationDeliveryTask(
        { db: database.db },
        {
          conversationId: scope.conversationId,
        },
      );
      if (claimedTask === null) {
        throw new Error("Expected a claimed conversation delivery task.");
      }

      const finalizedTask = await finalizeConversationDeliveryTask(
        { db: database.db },
        {
          taskId: claimedTask.id,
          status: ConversationDeliveryTaskStatuses.FAILED,
          failureCode: "delivery_failed",
          failureMessage: "Delivery failed for testing.",
        },
      );

      expect(finalizedTask.status).toBe(ConversationDeliveryTaskStatuses.FAILED);
      expect(finalizedTask.failureCode).toBe("delivery_failed");
      expect(finalizedTask.failureMessage).toBe("Delivery failed for testing.");
      expect(finalizedTask.finishedAt).not.toBeNull();

      await expect(
        finalizeConversationDeliveryTask(
          { db: database.db },
          {
            taskId: claimedTask.id,
            status: ConversationDeliveryTaskStatuses.COMPLETED,
          },
        ),
      ).rejects.toMatchObject({
        code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_PROCESSING,
      });
    } finally {
      await database.stop();
    }
  });
});
