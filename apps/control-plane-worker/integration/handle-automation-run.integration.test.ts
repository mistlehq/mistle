import {
  automationRuns,
  AutomationRunStatuses,
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
import type { HandleAutomationRunWorkflowInput } from "@mistle/workflows/control-plane";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  markAutomationRunCompleted,
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

describe("handleAutomationRun integration", () => {
  async function executeHandleAutomationRunSteps(input: {
    db: ReturnType<typeof createControlPlaneDatabase>;
    automationRunId: string;
  }) {
    const workflowInput: HandleAutomationRunWorkflowInput = {
      automationRunId: input.automationRunId,
    };
    const deps = {
      db: input.db,
    };

    const transitionResult = await transitionAutomationRunToRunning(deps, workflowInput);
    if (!transitionResult.shouldProcess) {
      return;
    }

    try {
      await prepareAutomationRun(deps, workflowInput);
      await markAutomationRunCompleted(deps, workflowInput);
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
    "prepares a structured automation run context with rendered templates",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_automation_prepare";
        const sandboxProfileId = "sbp_worker_automation_prepare";
        const automationId = "atm_worker_automation_prepare";
        const automationTargetId = "atg_worker_automation_prepare";
        const webhookEventId = "iwe_worker_automation_prepare";
        const automationRunId = "aru_worker_automation_prepare";
        const connectionId = "icn_worker_automation_prepare";
        const targetKey = "github-cloud-worker-automation-prepare";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Prepare",
          slug: "worker-automation-prepare",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Prepare Profile",
          status: "active",
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
          displayName: "Worker automation connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {},
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Prepare",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationConnectionId: connectionId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Handle {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 7,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          targetKey,
          externalEventId: "evt_prepare",
          externalDeliveryId: "delivery_prepare",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 777,
            },
            comment: {
              body: "@mistlebot prepare",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
        });
        await database.db.insert(automationRuns).values({
          id: automationRunId,
          automationId,
          automationTargetId,
          sourceWebhookEventId: webhookEventId,
          status: AutomationRunStatuses.QUEUED,
        });

        const preparedRun = await prepareAutomationRun(
          {
            db: database.db,
          },
          {
            automationRunId,
          },
        );

        expect(preparedRun).toMatchObject({
          automationRunId,
          automationId,
          automationTargetId,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 7,
          webhookEventId,
          webhookEventType: "github.issue_comment.created",
          webhookProviderEventType: "issue_comment",
          webhookExternalEventId: "evt_prepare",
          webhookExternalDeliveryId: "delivery_prepare",
          renderedInput: "Handle @mistlebot prepare",
          renderedConversationKey: "issue-777",
          renderedIdempotencyKey: "delivery_prepare",
        });
        expect(preparedRun.webhookPayload).toEqual({
          issue: {
            number: 777,
          },
          comment: {
            body: "@mistlebot prepare",
          },
        });
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "marks queued runs completed when templates compile successfully",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_automation_run_complete";
        const sandboxProfileId = "sbp_worker_automation_run_complete";
        const automationId = "atm_worker_automation_run_complete";
        const automationTargetId = "atg_worker_automation_run_complete";
        const webhookEventId = "iwe_worker_automation_run_complete";
        const automationRunId = "aru_worker_automation_run_complete";
        const connectionId = "icn_worker_automation_run_complete";
        const targetKey = "github-cloud-worker-automation-run-complete";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Run Complete",
          slug: "worker-automation-run-complete",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Run Complete Profile",
          status: "active",
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
          displayName: "Worker automation connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {},
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Run Complete",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationConnectionId: connectionId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Handle {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          targetKey,
          externalEventId: "evt_complete",
          externalDeliveryId: "delivery_complete",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 99,
            },
            comment: {
              body: "@mistlebot run",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
        });
        await database.db.insert(automationRuns).values({
          id: automationRunId,
          automationId,
          automationTargetId,
          sourceWebhookEventId: webhookEventId,
          status: AutomationRunStatuses.QUEUED,
        });

        await executeHandleAutomationRunSteps({
          db: database.db,
          automationRunId,
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.COMPLETED);
        expect(persistedRun.startedAt).toBeDefined();
        expect(persistedRun.finishedAt).toBeDefined();
        expect(persistedRun.failureCode).toBeNull();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "continues processing and completes runs already in running status",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_automation_run_running";
        const sandboxProfileId = "sbp_worker_automation_run_running";
        const automationId = "atm_worker_automation_run_running";
        const automationTargetId = "atg_worker_automation_run_running";
        const webhookEventId = "iwe_worker_automation_run_running";
        const automationRunId = "aru_worker_automation_run_running";
        const connectionId = "icn_worker_automation_run_running";
        const targetKey = "github-cloud-worker-automation-run-running";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Run Running",
          slug: "worker-automation-run-running",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Run Running Profile",
          status: "active",
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
          displayName: "Worker automation connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {},
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Run Running",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationConnectionId: connectionId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Handle {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          targetKey,
          externalEventId: "evt_running",
          externalDeliveryId: "delivery_running",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 101,
            },
            comment: {
              body: "@mistlebot replay",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
        });
        await database.db.insert(automationRuns).values({
          id: automationRunId,
          automationId,
          automationTargetId,
          sourceWebhookEventId: webhookEventId,
          status: AutomationRunStatuses.RUNNING,
        });

        await executeHandleAutomationRunSteps({
          db: database.db,
          automationRunId,
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.COMPLETED);
        expect(persistedRun.finishedAt).toBeDefined();
        expect(persistedRun.failureCode).toBeNull();
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
        const organizationId = "org_worker_automation_run_fail";
        const sandboxProfileId = "sbp_worker_automation_run_fail";
        const automationId = "atm_worker_automation_run_fail";
        const automationTargetId = "atg_worker_automation_run_fail";
        const webhookEventId = "iwe_worker_automation_run_fail";
        const automationRunId = "aru_worker_automation_run_fail";
        const connectionId = "icn_worker_automation_run_fail";
        const targetKey = "github-cloud-worker-automation-run-fail";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Run Fail",
          slug: "worker-automation-run-fail",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Run Fail Profile",
          status: "active",
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
          displayName: "Worker automation connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {},
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Run Fail",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationConnectionId: connectionId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Handle {{payload.comment.missing_field}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: null,
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          targetKey,
          externalEventId: "evt_fail",
          externalDeliveryId: "delivery_fail",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 100,
            },
            comment: {
              body: "@mistlebot run",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
        });
        await database.db.insert(automationRuns).values({
          id: automationRunId,
          automationId,
          automationTargetId,
          sourceWebhookEventId: webhookEventId,
          status: AutomationRunStatuses.QUEUED,
        });

        await expect(
          executeHandleAutomationRunSteps({
            db: database.db,
            automationRunId,
          }),
        ).rejects.toThrowError("undefined variable: payload.comment.missing_field");

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.FAILED);
        expect(persistedRun.finishedAt).toBeDefined();
        expect(persistedRun.failureCode).toBe("template_render_failed");
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
