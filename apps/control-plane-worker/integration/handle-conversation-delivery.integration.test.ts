import {
  automationTargets,
  automationRuns,
  AutomationRunStatuses,
  automations,
  AutomationKinds,
  conversationDeliveryProcessors,
  ConversationDeliveryProcessorStatuses,
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
  conversations,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  ConversationProviderFamilies,
  ConversationStatuses,
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
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { handleConversationDelivery } from "../src/runtime/services/handle-conversation-delivery.js";
import { it } from "./test-context.js";

const TestTimeoutMs = 120_000;

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

function createUnexpectedDeliveryDependencies(db: ReturnType<typeof createControlPlaneDatabase>) {
  return {
    db,
    startSandboxProfileInstance: async () => {
      throw new Error("Expected sandbox startup to be unreachable in this test.");
    },
    getSandboxInstance: async () => {
      throw new Error("Expected sandbox reads to be unreachable in this test.");
    },
    mintSandboxConnectionToken: async () => {
      throw new Error("Expected sandbox connection minting to be unreachable in this test.");
    },
  };
}

async function seedConversationDeliveryScenario(input: {
  database: Awaited<ReturnType<typeof createTestDatabase>>;
  suffix: string;
  conversationLastProcessedSourceOrderKey: string | null;
  tasks: ReadonlyArray<{
    taskSuffix: string;
    sourceOrderKey: string;
    renderedInput: string | null;
    renderedConversationKey: string | null;
  }>;
}) {
  const organizationId = `org_${input.suffix}`;
  const sandboxProfileId = `sbp_${input.suffix}`;
  const automationId = `atm_${input.suffix}`;
  const automationTargetId = `atg_${input.suffix}`;
  const conversationId = `cnv_${input.suffix}`;
  const targetKey = `github-cloud-${input.suffix}`;
  const connectionId = `icn_${input.suffix}`;

  await input.database.db.insert(organizations).values({
    id: organizationId,
    name: `Organization ${input.suffix}`,
    slug: input.suffix,
  });
  await input.database.db.insert(sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Profile ${input.suffix}`,
    status: "active",
  });
  await input.database.db.insert(integrationTargets).values({
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.database.db.insert(integrationConnections).values({
    id: connectionId,
    organizationId,
    targetKey,
    displayName: `Connection ${input.suffix}`,
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: `subject_${input.suffix}`,
    config: {},
  });
  await input.database.db.insert(automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Automation ${input.suffix}`,
    enabled: true,
  });
  await input.database.db.insert(automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });
  await input.database.db.insert(conversations).values({
    id: conversationId,
    organizationId,
    ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
    ownerId: automationTargetId,
    conversationKey: `conversation-${input.suffix}`,
    sandboxProfileId,
    providerFamily: ConversationProviderFamilies.CODEX,
    status: ConversationStatuses.ACTIVE,
    createdByKind: ConversationCreatedByKinds.WEBHOOK,
    createdById: `seed_${input.suffix}`,
    lastProcessedSourceOrderKey: input.conversationLastProcessedSourceOrderKey,
    lastProcessedWebhookEventId: null,
    title: null,
    preview: `Preview ${input.suffix}`,
  });
  await input.database.db.insert(conversationDeliveryProcessors).values({
    conversationId,
    generation: 1,
    status: ConversationDeliveryProcessorStatuses.RUNNING,
    activeWorkflowRunId: `wfr_${input.suffix}`,
  });

  for (const taskInput of input.tasks) {
    const webhookEventId = `iwe_${taskInput.taskSuffix}`;
    const automationRunId = `aru_${taskInput.taskSuffix}`;

    await input.database.db.insert(integrationWebhookEvents).values({
      id: webhookEventId,
      organizationId,
      integrationConnectionId: connectionId,
      targetKey,
      externalEventId: `evt_${taskInput.taskSuffix}`,
      externalDeliveryId: `delivery_${taskInput.taskSuffix}`,
      providerEventType: "issue_comment",
      eventType: "github.issue_comment.created",
      payload: {
        issue: {
          number: 1,
        },
      },
      status: IntegrationWebhookEventStatuses.PROCESSED,
      sourceOccurredAt: taskInput.sourceOrderKey.split("#")[0] ?? null,
      sourceOrderKey: taskInput.sourceOrderKey,
    });

    await input.database.db.insert(automationRuns).values({
      id: automationRunId,
      automationId,
      automationTargetId,
      sourceWebhookEventId: webhookEventId,
      conversationId,
      renderedInput: taskInput.renderedInput,
      renderedConversationKey: taskInput.renderedConversationKey,
      status: AutomationRunStatuses.RUNNING,
    });

    await input.database.db.insert(conversationDeliveryTasks).values({
      id: `cdt_${taskInput.taskSuffix}`,
      conversationId,
      automationRunId,
      sourceWebhookEventId: webhookEventId,
      sourceOrderKey: taskInput.sourceOrderKey,
      sandboxProfileId,
      sandboxProfileVersion: 1,
      providerFamily: ConversationProviderFamilies.CODEX,
      providerModel: "gpt-5.3-codex",
      status: ConversationDeliveryTaskStatuses.QUEUED,
    });
  }

  return {
    automationId,
    conversationId,
  };
}

describe("handleConversationDelivery integration", () => {
  it(
    "marks stale queued tasks ignored without touching sandbox dependencies",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedConversationDeliveryScenario({
          database,
          suffix: "worker_conversation_delivery_stale",
          conversationLastProcessedSourceOrderKey: "2026-03-08T09:00:00Z#00000000000000002000",
          tasks: [
            {
              taskSuffix: "worker_conversation_delivery_stale",
              sourceOrderKey: "2026-03-08T08:59:00Z#00000000000000001999",
              renderedInput: "Handle stale event",
              renderedConversationKey: "issue-1",
            },
          ],
        });

        const result = await handleConversationDelivery(
          createUnexpectedDeliveryDependencies(database.db),
          {
            conversationId: seeded.conversationId,
            generation: 1,
          },
        );

        expect(result).toEqual({
          conversationId: seeded.conversationId,
          generation: 1,
        });

        const queuedTask = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.id, "cdt_worker_conversation_delivery_stale"),
        });
        expect(queuedTask?.status).toBe(ConversationDeliveryTaskStatuses.IGNORED);
        expect(queuedTask?.finishedAt).not.toBeNull();

        const automationRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, "aru_worker_conversation_delivery_stale"),
        });
        expect(automationRun?.status).toBe(AutomationRunStatuses.IGNORED);
        expect(automationRun?.finishedAt).not.toBeNull();

        const processor = await database.db.query.conversationDeliveryProcessors.findFirst({
          where: (table, { eq }) => eq(table.conversationId, seeded.conversationId),
        });
        expect(processor?.status).toBe(ConversationDeliveryProcessorStatuses.IDLE);
        expect(processor?.activeWorkflowRunId).toBeNull();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "marks failed tasks terminal and continues draining later queued tasks",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedConversationDeliveryScenario({
          database,
          suffix: "worker_conversation_delivery_failure",
          conversationLastProcessedSourceOrderKey: null,
          tasks: [
            {
              taskSuffix: "worker_conversation_delivery_failure_first",
              sourceOrderKey: "2026-03-08T09:01:00Z#00000000000000002001",
              renderedInput: null,
              renderedConversationKey: "issue-1",
            },
            {
              taskSuffix: "worker_conversation_delivery_failure_second",
              sourceOrderKey: "2026-03-08T09:02:00Z#00000000000000002002",
              renderedInput: "Handle second event",
              renderedConversationKey: null,
            },
          ],
        });

        const result = await handleConversationDelivery(
          createUnexpectedDeliveryDependencies(database.db),
          {
            conversationId: seeded.conversationId,
            generation: 1,
          },
        );

        expect(result).toEqual({
          conversationId: seeded.conversationId,
          generation: 1,
        });

        const firstTask = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.id, "cdt_worker_conversation_delivery_failure_first"),
        });
        const secondTask = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.id, "cdt_worker_conversation_delivery_failure_second"),
        });
        expect(firstTask?.status).toBe(ConversationDeliveryTaskStatuses.FAILED);
        expect(secondTask?.status).toBe(ConversationDeliveryTaskStatuses.FAILED);

        const firstRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, "aru_worker_conversation_delivery_failure_first"),
        });
        const secondRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, "aru_worker_conversation_delivery_failure_second"),
        });
        expect(firstRun?.status).toBe(AutomationRunStatuses.FAILED);
        expect(secondRun?.status).toBe(AutomationRunStatuses.FAILED);

        const processor = await database.db.query.conversationDeliveryProcessors.findFirst({
          where: (table, { eq }) => eq(table.conversationId, seeded.conversationId),
        });
        expect(processor?.status).toBe(ConversationDeliveryProcessorStatuses.IDLE);
        expect(processor?.activeWorkflowRunId).toBeNull();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
