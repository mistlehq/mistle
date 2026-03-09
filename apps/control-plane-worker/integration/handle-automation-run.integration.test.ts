import {
  automationRuns,
  AutomationRunStatuses,
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
import type { HandleAutomationRunWorkflowInput } from "@mistle/workflows/control-plane";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  claimAutomationConversation,
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
      const preparedAutomationRun = await prepareAutomationRun(deps, workflowInput);
      await claimAutomationConversation(deps, {
        preparedAutomationRun,
      });
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

  async function seedAgentBinding(input: {
    db: ReturnType<typeof createControlPlaneDatabase>;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    suffix: string;
  }) {
    const agentTargetKey = `openai-default-${input.suffix}`;
    const agentConnectionId = `icn_agent_${input.suffix}`;

    await input.db.insert(integrationTargets).values({
      targetKey: agentTargetKey,
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {},
    });
    await input.db.insert(integrationConnections).values({
      id: agentConnectionId,
      organizationId: input.organizationId,
      targetKey: agentTargetKey,
      displayName: `Agent Connection ${input.suffix}`,
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: `openai-agent-${input.suffix}`,
      config: {
        auth_scheme: "api_key",
      },
    });
    await input.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: input.sandboxProfileId,
      version: input.sandboxProfileVersion,
    });
    await input.db.insert(sandboxProfileVersionIntegrationBindings).values({
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      connectionId: agentConnectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    });
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
    "claims the logical conversation and persists rendered delivery state on the run",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_automation_claim";
        const sandboxProfileId = "sbp_worker_automation_claim";
        const automationId = "atm_worker_automation_claim";
        const automationTargetId = "atg_worker_automation_claim";
        const webhookEventId = "iwe_worker_automation_claim";
        const automationRunId = "aru_worker_automation_claim";
        const connectionId = "icn_worker_automation_claim";
        const targetKey = "github-cloud-worker-automation-claim";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Claim",
          slug: "worker-automation-claim",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Claim Profile",
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
          name: "Automation Claim",
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
          sandboxProfileVersion: 3,
        });
        await seedAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 3,
          suffix: "worker_automation_claim",
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          targetKey,
          externalEventId: "evt_claim",
          externalDeliveryId: "delivery_claim",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 42,
            },
            comment: {
              body: "@mistlebot claim",
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

        const preparedRun = await prepareAutomationRun(
          {
            db: database.db,
          },
          {
            automationRunId,
          },
        );
        const claimedConversation = await claimAutomationConversation(
          {
            db: database.db,
          },
          {
            preparedAutomationRun: preparedRun,
          },
        );

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedConversation = await database.db.query.conversations.findFirst({
          where: (table, { eq }) => eq(table.id, claimedConversation.conversationId),
        });

        expect(persistedRun?.conversationId).toBe(claimedConversation.conversationId);
        expect(persistedRun?.renderedInput).toBe("Handle @mistlebot claim");
        expect(persistedRun?.renderedConversationKey).toBe("issue-42");
        expect(persistedRun?.renderedIdempotencyKey).toBe("delivery_claim");

        expect(persistedConversation).toMatchObject({
          id: claimedConversation.conversationId,
          organizationId,
          ownerKind: "automation_target",
          ownerId: automationTargetId,
          conversationKey: "issue-42",
          sandboxProfileId,
          providerFamily: "codex",
          createdByKind: "webhook",
          createdById: webhookEventId,
          status: "pending",
          preview: "Handle @mistlebot claim",
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
        await seedAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          suffix: "worker_automation_run_complete",
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
        expect(persistedRun.conversationId).not.toBeNull();
        expect(persistedRun.renderedInput).toBe("Handle @mistlebot run");
        expect(persistedRun.renderedConversationKey).toBe("issue-99");
        expect(persistedRun.renderedIdempotencyKey).toBe("delivery_complete");
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
        await seedAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          suffix: "worker_automation_run_running",
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
        expect(persistedRun.conversationId).not.toBeNull();
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
        await seedAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          suffix: "worker_automation_run_fail",
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
