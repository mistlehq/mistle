import {
  automationTargets,
  automations,
  AutomationKinds,
  createControlPlaneDatabase,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
  organizations,
  sandboxProfiles,
  CONTROL_PLANE_SCHEMA_NAME,
  webhookAutomations,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { handleAutomationRun } from "../src/runtime/services/handle-automation-run.js";
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

describe("handleIntegrationWebhookEvent integration", () => {
  it(
    "resolves matching webhook automations and queues automation runs",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_webhook_queue";
        const targetKey = "github-cloud-worker-webhook-queue";
        const connectionId = "icn_worker_webhook_queue";
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
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
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
          conversationKeyTemplate: "github/{{installation.id}}",
          idempotencyKeyTemplate: "{{delivery.id}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 2,
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
              body: "please run @mistlebot",
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
        });

        const workflowOutput = await handleIntegrationWebhookEvent(
          {
            db: database.db,
            enqueueAutomationRuns: async ({ automationRunIds }) => {
              for (const automationRunId of automationRunIds) {
                await handleAutomationRun(
                  {
                    db: database.db,
                  },
                  {
                    automationRunId,
                  },
                );
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
        expect(queuedRun.status).toBe("completed");
      } finally {
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
