import {
  automationTargets,
  automations,
  AutomationKinds,
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
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  enqueuePreparedAutomationRun,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "../src/runtime/services/handle-automation-run.js";
import { handleIntegrationWebhookEvent } from "../src/runtime/services/handle-integration-webhook-event.js";
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

describe("handleIntegrationWebhookEvent integration", () => {
  async function executeHandleAutomationRunSteps(input: {
    db: ReturnType<typeof createControlPlaneDatabase>;
    openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
    automationRunId: string;
  }) {
    const workflowInput: HandleAutomationRunWorkflowInput = {
      automationRunId: input.automationRunId,
    };
    const deps = {
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

  it(
    "resolves matching webhook automations and queues automation runs",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });
      const workflowClient = await createTestWorkflowClient({
        databaseUrl: fixture.config.workflow.databaseUrl,
        namespaceId: `${fixture.config.workflow.namespaceId}-handle-webhook-event`,
      });

      try {
        const organizationId = "org_worker_webhook_queue";
        const targetKey = "github-cloud-worker-webhook-queue";
        const connectionId = "icn_worker_webhook_queue";
        const agentConnectionId = "icn_agent_worker_webhook_queue";
        const sandboxProfileId = "sbp_worker_webhook_queue";
        const automationId = "atm_worker_webhook_queue";
        const automationTargetId = "atg_worker_webhook_queue";
        const webhookEventId = "iwe_worker_webhook_queue";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Queue Org",
          slug: "worker-queue-org",
        });
        await database.db.insert(integrationTargets).values({
          targetKey,
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            api_base_url: "https://api.github.com",
            web_base_url: "https://github.com",
          },
        });
        await database.db.insert(integrationConnections).values({
          id: connectionId,
          organizationId,
          targetKey,
          displayName: "Worker webhook connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {},
        });
        await database.db.insert(integrationTargets).values({
          targetKey: "openai-default-worker-webhook-queue",
          familyId: "openai",
          variantId: "openai-default",
          enabled: true,
          config: {},
        });
        await database.db.insert(integrationConnections).values({
          id: agentConnectionId,
          organizationId,
          targetKey: "openai-default-worker-webhook-queue",
          displayName: "Worker agent connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "openai-agent",
          config: {},
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Worker Queue Profile",
          status: "active",
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Queue Automation",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationConnectionId: connectionId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: {
            op: "contains",
            path: ["comment", "body"],
            value: "@mistlebot",
          },
          inputTemplate: "Handle issue comment webhook",
          conversationKeyTemplate: "github/{{payload.installation.id}}",
          idempotencyKeyTemplate: "{{payload.delivery.id}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 2,
        });
        await database.db.insert(sandboxProfileVersions).values({
          sandboxProfileId,
          version: 2,
        });
        await database.db.insert(sandboxProfileVersionIntegrationBindings).values({
          sandboxProfileId,
          sandboxProfileVersion: 2,
          connectionId: agentConnectionId,
          kind: IntegrationBindingKinds.AGENT,
          config: {
            defaultModel: "gpt-5.3-codex",
          },
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          targetKey,
          externalEventId: "evt_queue",
          externalDeliveryId: "delivery_queue",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            installation: {
              id: 12345,
            },
            delivery: {
              id: "delivery_queue_payload",
            },
            comment: {
              id: 1005,
              created_at: "2026-03-08T08:20:30Z",
              body: "please run @mistlebot",
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
          sourceOccurredAt: "2026-03-08T08:20:30Z",
          sourceOrderKey: "2026-03-08T08:20:30Z#00000000000000001005",
        });

        const workflowOutput = await handleIntegrationWebhookEvent(
          {
            db: database.db,
            enqueueAutomationRuns: async ({ automationRunIds }) => {
              for (const automationRunId of automationRunIds) {
                await executeHandleAutomationRunSteps({
                  db: database.db,
                  openWorkflow: workflowClient.openWorkflow,
                  automationRunId,
                });
              }
            },
          },
          {
            webhookEventId,
          },
        );

        expect(workflowOutput).toEqual({
          webhookEventId,
        });

        const persistedEvent = await database.db.query.integrationWebhookEvents.findFirst({
          where: (table, { eq }) => eq(table.id, webhookEventId),
        });
        expect(persistedEvent).toBeDefined();
        if (persistedEvent === undefined) {
          throw new Error("Expected persisted webhook event.");
        }

        expect(persistedEvent.status).toBe(IntegrationWebhookEventStatuses.PROCESSED);
        expect(persistedEvent.finalizedAt).toBeDefined();

        const queuedRuns = await database.db.query.automationRuns.findMany({
          where: (table, { eq }) => eq(table.sourceWebhookEventId, webhookEventId),
        });
        expect(queuedRuns).toHaveLength(1);
        const [queuedRun] = queuedRuns;
        if (queuedRun === undefined) {
          throw new Error("Expected queued automation run.");
        }

        expect(queuedRun.automationId).toBe(automationId);
        expect(queuedRun.automationTargetId).toBe(automationTargetId);
        expect(queuedRun.status).toBe("running");
        expect(queuedRun.conversationId).toBeDefined();
        expect(queuedRun.renderedInput).toBe("Handle issue comment webhook");
        expect(queuedRun.renderedConversationKey).toBe("github/12345");
        expect(queuedRun.renderedIdempotencyKey).toBe("delivery_queue_payload");

        const queuedTasks = await database.db.query.conversationDeliveryTasks.findMany({
          where: (table, { eq }) => eq(table.automationRunId, queuedRun.id),
        });
        expect(queuedTasks).toHaveLength(1);
        const [queuedTask] = queuedTasks;
        if (queuedTask === undefined) {
          throw new Error("Expected queued delivery task.");
        }

        expect(queuedTask.status).toBe("queued");
        expect(queuedTask.sourceWebhookEventId).toBe(webhookEventId);
        expect(queuedTask.sourceOrderKey).toBe("2026-03-08T08:20:30Z#00000000000000001005");

        const persistedProcessor = await database.db.query.conversationDeliveryProcessors.findFirst(
          {
            where: (table, { eq }) => eq(table.conversationId, queuedTask.conversationId),
          },
        );
        expect(persistedProcessor).toBeDefined();
        if (persistedProcessor === undefined) {
          throw new Error("Expected queued conversation processor.");
        }

        expect(persistedProcessor.status).toBe("running");
        expect(persistedProcessor.generation).toBe(1);
        expect(persistedProcessor.activeWorkflowRunId).not.toBeNull();
      } finally {
        await workflowClient.stop();
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "marks webhook event ignored when no automation targets resolve",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_webhook_ignore";
        const targetKey = "github-cloud-worker-webhook-ignore";
        const connectionId = "icn_worker_webhook_ignore";
        const webhookEventId = "iwe_worker_webhook_ignore";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Ignore Org",
          slug: "worker-ignore-org",
        });
        await database.db.insert(integrationTargets).values({
          targetKey,
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            api_base_url: "https://api.github.com",
            web_base_url: "https://github.com",
          },
        });
        await database.db.insert(integrationConnections).values({
          id: connectionId,
          organizationId,
          targetKey,
          displayName: "Worker webhook connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {},
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          targetKey,
          externalEventId: "evt_ignore",
          externalDeliveryId: "delivery_ignore",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            comment: {
              body: "nothing to match",
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
        });

        const workflowOutput = await handleIntegrationWebhookEvent(
          {
            db: database.db,
            enqueueAutomationRuns: async () => {},
          },
          {
            webhookEventId,
          },
        );

        expect(workflowOutput).toEqual({
          webhookEventId,
        });

        const persistedEvent = await database.db.query.integrationWebhookEvents.findFirst({
          where: (table, { eq }) => eq(table.id, webhookEventId),
        });
        expect(persistedEvent).toBeDefined();
        if (persistedEvent === undefined) {
          throw new Error("Expected persisted webhook event.");
        }

        expect(persistedEvent.status).toBe(IntegrationWebhookEventStatuses.IGNORED);
        expect(persistedEvent.finalizedAt).toBeDefined();

        const queuedRuns = await database.db.query.automationRuns.findMany({
          where: (table, { eq }) => eq(table.sourceWebhookEventId, webhookEventId),
        });
        expect(queuedRuns).toHaveLength(0);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
