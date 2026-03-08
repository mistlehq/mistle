import {
  automationRuns,
  AutomationRunStatuses,
  automationTargets,
  automations,
  AutomationKinds,
  ConversationDeliveryProcessorStatuses,
  ConversationDeliveryTaskStatuses,
  ConversationOwnerKinds,
  createControlPlaneDatabase,
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
  organizations,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  CONTROL_PLANE_SCHEMA_NAME,
  webhookAutomations,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  type HandleAutomationRunWorkflowInput,
} from "@mistle/workflows/control-plane";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  enqueuePreparedAutomationRun,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "../src/runtime/services/handle-automation-run.js";
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

async function createTestWorkflowClient(input: { databaseUrl: string; namespaceId: string }) {
  const backend = await createControlPlaneBackend({
    url: input.databaseUrl,
    namespaceId: input.namespaceId,
    runMigrations: true,
  });
  const openWorkflow = createControlPlaneOpenWorkflow({
    backend,
  });

  return {
    openWorkflow,
    stop: async () => {
      await backend.stop();
    },
  };
}

type SeedAutomationRunScenarioInput = {
  database: Awaited<ReturnType<typeof createTestDatabase>>;
  suffix: string;
  automationRunStatus: (typeof AutomationRunStatuses)[keyof typeof AutomationRunStatuses];
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  payload: Record<string, unknown>;
  sourceOccurredAt: string;
  sourceOrderKey: string;
};

async function seedAutomationRunScenario(input: SeedAutomationRunScenarioInput) {
  const organizationId = `org_${input.suffix}`;
  const sandboxProfileId = `sbp_${input.suffix}`;
  const automationId = `atm_${input.suffix}`;
  const automationTargetId = `atg_${input.suffix}`;
  const webhookEventId = `iwe_${input.suffix}`;
  const automationRunId = `aru_${input.suffix}`;
  const connectionId = `icn_${input.suffix}`;
  const agentConnectionId = `icn_agent_${input.suffix}`;
  const targetKey = `github-cloud-${input.suffix}`;
  const agentTargetKey = `openai-default-${input.suffix}`;

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
    externalSubjectId: "123456",
    config: {},
  });
  await input.database.db.insert(integrationTargets).values({
    targetKey: agentTargetKey,
    familyId: "openai",
    variantId: "openai-default",
    enabled: true,
    config: {},
  });
  await input.database.db.insert(integrationConnections).values({
    id: agentConnectionId,
    organizationId,
    targetKey: agentTargetKey,
    displayName: `Agent Connection ${input.suffix}`,
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: "openai-agent",
    config: {},
  });
  await input.database.db.insert(automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Automation ${input.suffix}`,
    enabled: true,
  });
  await input.database.db.insert(webhookAutomations).values({
    automationId,
    integrationConnectionId: connectionId,
    eventTypes: ["github.issue_comment.created"],
    payloadFilter: null,
    inputTemplate: input.inputTemplate,
    conversationKeyTemplate: input.conversationKeyTemplate,
    idempotencyKeyTemplate: input.idempotencyKeyTemplate,
  });
  await input.database.db.insert(automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 7,
  });
  await input.database.db.insert(sandboxProfileVersions).values({
    sandboxProfileId,
    version: 7,
  });
  await input.database.db.insert(sandboxProfileVersionIntegrationBindings).values({
    sandboxProfileId,
    sandboxProfileVersion: 7,
    connectionId: agentConnectionId,
    kind: IntegrationBindingKinds.AGENT,
    config: {
      defaultModel: "gpt-5.3-codex",
    },
  });
  await input.database.db.insert(integrationWebhookEvents).values({
    id: webhookEventId,
    organizationId,
    integrationConnectionId: connectionId,
    targetKey,
    externalEventId: `evt_${input.suffix}`,
    externalDeliveryId: `delivery_${input.suffix}`,
    providerEventType: "issue_comment",
    eventType: "github.issue_comment.created",
    payload: input.payload,
    status: IntegrationWebhookEventStatuses.PROCESSED,
    sourceOccurredAt: input.sourceOccurredAt,
    sourceOrderKey: input.sourceOrderKey,
  });
  await input.database.db.insert(automationRuns).values({
    id: automationRunId,
    automationId,
    automationTargetId,
    sourceWebhookEventId: webhookEventId,
    status: input.automationRunStatus,
  });

  return {
    organizationId,
    sandboxProfileId,
    automationId,
    automationTargetId,
    webhookEventId,
    automationRunId,
  };
}

async function executeHandleAutomationRunSteps(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  openWorkflow?: ReturnType<typeof createControlPlaneOpenWorkflow>;
  automationRunId: string;
}) {
  const workflowInput: HandleAutomationRunWorkflowInput = {
    automationRunId: input.automationRunId,
  };
  const deps =
    input.openWorkflow === undefined
      ? {
          db: input.db,
        }
      : {
          db: input.db,
          openWorkflow: input.openWorkflow,
        };

  const transitionResult = await transitionAutomationRunToRunning(deps, workflowInput);
  if (!transitionResult.shouldProcess) {
    return;
  }

  try {
    const preparedAutomationRun = await prepareAutomationRun(deps, workflowInput);
    await enqueuePreparedAutomationRun(deps, {
      preparedAutomationRun,
    });
  } catch (error) {
    const failure = resolveAutomationRunFailure(error);
    await markAutomationRunFailed(deps, {
      automationRunId: workflowInput.automationRunId,
      failureCode: failure.code,
      failureMessage: failure.message,
    });
    throw error;
  }
}

describe("handleAutomationRun integration", () => {
  it(
    "prepares a structured automation run context with rendered templates and source ordering",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedAutomationRunScenario({
          database,
          suffix: "worker_automation_prepare",
          automationRunStatus: AutomationRunStatuses.QUEUED,
          inputTemplate: "Handle {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
          payload: {
            issue: {
              number: 777,
            },
            comment: {
              id: 1001,
              created_at: "2026-03-08T08:15:30Z",
              body: "@mistlebot prepare",
            },
          },
          sourceOccurredAt: "2026-03-08T08:15:30Z",
          sourceOrderKey: "2026-03-08T08:15:30Z#00000000000000001001",
        });

        const preparedRun = await prepareAutomationRun(
          {
            db: database.db,
          },
          {
            automationRunId: seeded.automationRunId,
          },
        );

        expect(preparedRun).toMatchObject({
          automationRunId: seeded.automationRunId,
          automationId: seeded.automationId,
          automationTargetId: seeded.automationTargetId,
          organizationId: seeded.organizationId,
          sandboxProfileId: seeded.sandboxProfileId,
          sandboxProfileVersion: 7,
          webhookEventId: seeded.webhookEventId,
          webhookEventType: "github.issue_comment.created",
          webhookProviderEventType: "issue_comment",
          webhookExternalEventId: "evt_worker_automation_prepare",
          webhookExternalDeliveryId: "delivery_worker_automation_prepare",
          sourceOrderKey: "2026-03-08T08:15:30Z#00000000000000001001",
          renderedInput: "Handle @mistlebot prepare",
          renderedConversationKey: "issue-777",
          renderedIdempotencyKey: "delivery_worker_automation_prepare",
        });
        expect(preparedRun.sourceOccurredAt).not.toBeNull();
        expect(new Date(preparedRun.sourceOccurredAt ?? "").toISOString()).toBe(
          "2026-03-08T08:15:30.000Z",
        );
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "enqueues queued runs and persists frozen delivery state",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });
      const workflowClient = await createTestWorkflowClient({
        databaseUrl: fixture.config.workflow.databaseUrl,
        namespaceId: `${fixture.config.workflow.namespaceId}-handle-automation-run`,
      });

      try {
        const seeded = await seedAutomationRunScenario({
          database,
          suffix: "worker_automation_enqueue",
          automationRunStatus: AutomationRunStatuses.QUEUED,
          inputTemplate: "Handle {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
          payload: {
            issue: {
              number: 99,
            },
            comment: {
              id: 1002,
              created_at: "2026-03-08T08:16:30Z",
              body: "@mistlebot run",
            },
          },
          sourceOccurredAt: "2026-03-08T08:16:30Z",
          sourceOrderKey: "2026-03-08T08:16:30Z#00000000000000001002",
        });

        await executeHandleAutomationRunSteps({
          db: database.db,
          openWorkflow: workflowClient.openWorkflow,
          automationRunId: seeded.automationRunId,
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, seeded.automationRunId),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.RUNNING);
        expect(persistedRun.startedAt).toBeDefined();
        expect(persistedRun.finishedAt).toBeNull();
        expect(persistedRun.failureCode).toBeNull();
        expect(persistedRun.conversationId).toBeDefined();
        expect(persistedRun.renderedInput).toBe("Handle @mistlebot run");
        expect(persistedRun.renderedConversationKey).toBe("issue-99");
        expect(persistedRun.renderedIdempotencyKey).toBe("delivery_worker_automation_enqueue");

        const persistedConversation = await database.db.query.conversations.findFirst({
          where: (table, { eq }) => eq(table.id, persistedRun.conversationId ?? ""),
        });
        expect(persistedConversation).toBeDefined();
        if (persistedConversation === undefined) {
          throw new Error("Expected persisted conversation.");
        }

        expect(persistedConversation.ownerKind).toBe(ConversationOwnerKinds.AUTOMATION_TARGET);
        expect(persistedConversation.ownerId).toBe(seeded.automationTargetId);
        expect(persistedConversation.conversationKey).toBe("issue-99");
        expect(persistedConversation.preview).toBe("Handle @mistlebot run");

        const queuedTasks = await database.db.query.conversationDeliveryTasks.findMany({
          where: (table, { eq }) => eq(table.automationRunId, seeded.automationRunId),
        });
        expect(queuedTasks).toHaveLength(1);
        const [queuedTask] = queuedTasks;
        if (queuedTask === undefined) {
          throw new Error("Expected queued delivery task.");
        }

        expect(queuedTask.conversationId).toBe(persistedConversation.id);
        expect(queuedTask.sourceWebhookEventId).toBe(seeded.webhookEventId);
        expect(queuedTask.sourceOrderKey).toBe("2026-03-08T08:16:30Z#00000000000000001002");
        expect(queuedTask.sandboxProfileId).toBe(seeded.sandboxProfileId);
        expect(queuedTask.sandboxProfileVersion).toBe(7);
        expect(queuedTask.providerFamily).toBe("codex");
        expect(queuedTask.providerModel).toBe("gpt-5.3-codex");
        expect(queuedTask.status).toBe(ConversationDeliveryTaskStatuses.QUEUED);

        const persistedProcessor = await database.db.query.conversationDeliveryProcessors.findFirst(
          {
            where: (table, { eq }) => eq(table.conversationId, persistedConversation.id),
          },
        );
        expect(persistedProcessor).toBeDefined();
        if (persistedProcessor === undefined) {
          throw new Error("Expected persisted conversation delivery processor.");
        }

        expect(persistedProcessor.status).toBe(ConversationDeliveryProcessorStatuses.RUNNING);
        expect(persistedProcessor.generation).toBe(1);
        expect(persistedProcessor.activeWorkflowRunId).not.toBeNull();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "continues processing already-running runs without duplicating queued tasks",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });
      const workflowClient = await createTestWorkflowClient({
        databaseUrl: fixture.config.workflow.databaseUrl,
        namespaceId: `${fixture.config.workflow.namespaceId}-handle-automation-run`,
      });

      try {
        const seeded = await seedAutomationRunScenario({
          database,
          suffix: "worker_automation_running",
          automationRunStatus: AutomationRunStatuses.RUNNING,
          inputTemplate: "Handle {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
          payload: {
            issue: {
              number: 101,
            },
            comment: {
              id: 1003,
              created_at: "2026-03-08T08:17:30Z",
              body: "@mistlebot replay",
            },
          },
          sourceOccurredAt: "2026-03-08T08:17:30Z",
          sourceOrderKey: "2026-03-08T08:17:30Z#00000000000000001003",
        });

        await executeHandleAutomationRunSteps({
          db: database.db,
          openWorkflow: workflowClient.openWorkflow,
          automationRunId: seeded.automationRunId,
        });
        await database.db
          .update(webhookAutomations)
          .set({
            inputTemplate: "Changed {{payload.comment.body}}",
            conversationKeyTemplate: "changed-{{payload.issue.number}}",
          })
          .where(eq(webhookAutomations.automationId, seeded.automationId));
        await executeHandleAutomationRunSteps({
          db: database.db,
          openWorkflow: workflowClient.openWorkflow,
          automationRunId: seeded.automationRunId,
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, seeded.automationRunId),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.RUNNING);
        expect(persistedRun.finishedAt).toBeNull();
        expect(persistedRun.renderedInput).toBe("Handle @mistlebot replay");
        expect(persistedRun.renderedConversationKey).toBe("issue-101");

        const queuedTasks = await database.db.query.conversationDeliveryTasks.findMany({
          where: (table, { eq }) => eq(table.automationRunId, seeded.automationRunId),
        });
        expect(queuedTasks).toHaveLength(1);
        expect(queuedTasks[0]?.sandboxProfileId).toBe(seeded.sandboxProfileId);
        expect(queuedTasks[0]?.sandboxProfileVersion).toBe(7);
        expect(queuedTasks[0]?.providerFamily).toBe("codex");
        expect(queuedTasks[0]?.providerModel).toBe("gpt-5.3-codex");

        const persistedProcessors = await database.db.query.conversationDeliveryProcessors.findMany(
          {
            where: (table, { eq }) => eq(table.conversationId, persistedRun.conversationId ?? ""),
          },
        );
        expect(persistedProcessors).toHaveLength(1);
        expect(persistedProcessors[0]?.status).toBe(ConversationDeliveryProcessorStatuses.RUNNING);
        expect(persistedProcessors[0]?.generation).toBe(1);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "rehydrates frozen delivery state after the automation target is deleted",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });
      const workflowClient = await createTestWorkflowClient({
        databaseUrl: fixture.config.workflow.databaseUrl,
        namespaceId: `${fixture.config.workflow.namespaceId}-handle-automation-run-target-delete`,
      });

      try {
        const seeded = await seedAutomationRunScenario({
          database,
          suffix: "worker_automation_target_deleted",
          automationRunStatus: AutomationRunStatuses.RUNNING,
          inputTemplate: "Handle {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
          payload: {
            issue: {
              number: 202,
            },
            comment: {
              id: 1005,
              created_at: "2026-03-08T08:19:30Z",
              body: "@mistlebot keep frozen state",
            },
          },
          sourceOccurredAt: "2026-03-08T08:19:30Z",
          sourceOrderKey: "2026-03-08T08:19:30Z#00000000000000001005",
        });

        await executeHandleAutomationRunSteps({
          db: database.db,
          openWorkflow: workflowClient.openWorkflow,
          automationRunId: seeded.automationRunId,
        });

        await database.db
          .update(webhookAutomations)
          .set({
            inputTemplate: "Changed {{payload.comment.body}}",
            conversationKeyTemplate: "changed-{{payload.issue.number}}",
          })
          .where(eq(webhookAutomations.automationId, seeded.automationId));

        await database.db
          .delete(automationTargets)
          .where(eq(automationTargets.id, seeded.automationTargetId));

        await executeHandleAutomationRunSteps({
          db: database.db,
          openWorkflow: workflowClient.openWorkflow,
          automationRunId: seeded.automationRunId,
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, seeded.automationRunId),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.automationTargetId).toBeNull();
        expect(persistedRun.status).toBe(AutomationRunStatuses.RUNNING);
        expect(persistedRun.renderedInput).toBe("Handle @mistlebot keep frozen state");
        expect(persistedRun.renderedConversationKey).toBe("issue-202");

        const queuedTasks = await database.db.query.conversationDeliveryTasks.findMany({
          where: (table, { eq }) => eq(table.automationRunId, seeded.automationRunId),
        });
        expect(queuedTasks).toHaveLength(1);
        expect(queuedTasks[0]?.sandboxProfileId).toBe(seeded.sandboxProfileId);
        expect(queuedTasks[0]?.sandboxProfileVersion).toBe(7);
        expect(queuedTasks[0]?.providerFamily).toBe("codex");
        expect(queuedTasks[0]?.providerModel).toBe("gpt-5.3-codex");
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "marks runs failed when template rendering fails",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedAutomationRunScenario({
          database,
          suffix: "worker_automation_fail",
          automationRunStatus: AutomationRunStatuses.QUEUED,
          inputTemplate: "Handle {{payload.comment.missing_field}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: null,
          payload: {
            issue: {
              number: 100,
            },
            comment: {
              id: 1004,
              created_at: "2026-03-08T08:18:30Z",
              body: "@mistlebot run",
            },
          },
          sourceOccurredAt: "2026-03-08T08:18:30Z",
          sourceOrderKey: "2026-03-08T08:18:30Z#00000000000000001004",
        });

        await expect(
          executeHandleAutomationRunSteps({
            db: database.db,
            automationRunId: seeded.automationRunId,
          }),
        ).rejects.toThrowError("undefined variable: payload.comment.missing_field");

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, seeded.automationRunId),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.FAILED);
        expect(persistedRun.finishedAt).toBeDefined();
        expect(persistedRun.failureCode).toBe("template_render_failed");
        expect(persistedRun.conversationId).toBeNull();

        const persistedConversations = await database.db.query.conversations.findMany({
          where: (table, { eq }) => eq(table.ownerId, seeded.automationTargetId),
        });
        expect(persistedConversations).toHaveLength(0);

        const queuedTasks = await database.db.query.conversationDeliveryTasks.findMany({
          where: (table, { eq }) => eq(table.automationRunId, seeded.automationRunId),
        });
        expect(queuedTasks).toHaveLength(0);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
