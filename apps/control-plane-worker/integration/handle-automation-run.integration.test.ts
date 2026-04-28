import {
  AutomationConversationDeliveryProcessorStatuses,
  AutomationConversationDeliveryTaskStatuses,
  automationRuns,
  AutomationRunStatuses,
  automationTargets,
  automations,
  AutomationKinds,
  AutomationConversationCreatedByKinds,
  AutomationConversationOwnerKinds,
  AutomationConversationStatuses,
  createControlPlaneDatabase,
  integrationConnections,
  IntegrationConnectionStatuses,
  IntegrationBindingKinds,
  integrationTargets,
  integrationWebhookEvents,
  integrationWebhookSources,
  IntegrationWebhookEventStatuses,
  organizations,
  sandboxProfiles,
  sandboxProfileVersions,
  sandboxProfileVersionIntegrationBindings,
  CONTROL_PLANE_SCHEMA_NAME,
  users,
  webhookAutomations,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import {
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
  OpenAiApiKeyDefinition,
} from "@mistle/integrations-definitions";
import {
  HandleAutomationConversationDeliveryWorkflowSpec,
  HandleAutomationRunWorkflowSpec,
  type HandleAutomationRunWorkflowInput,
} from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { claimOrResumeAutomationConversationDeliveryTask } from "../openworkflow/handle-automation-conversation-delivery/claim-or-resume-automation-conversation-delivery-task.js";
import { finalizeAutomationConversationDeliveryTask } from "../openworkflow/handle-automation-conversation-delivery/finalize-automation-conversation-delivery-task.js";
import { idleAutomationConversationDeliveryProcessorIfEmpty } from "../openworkflow/handle-automation-conversation-delivery/idle-automation-conversation-delivery-processor-if-empty.js";
import {
  AutomationConversationDeliveryTaskActions,
  resolveAutomationConversationDeliveryTaskAction,
} from "../openworkflow/handle-automation-conversation-delivery/resolve-automation-conversation-delivery-task-action.js";
import { handoffAutomationRunDelivery } from "../openworkflow/handle-automation-run/handoff-automation-run-delivery.js";
import { transitionAutomationRunToRunning } from "../openworkflow/handle-automation-run/transition-automation-run-to-running.js";
import { HandleAutomationRunWorkflow } from "../openworkflow/handle-automation-run/workflow.js";
import {
  markAutomationRunFailed,
  markAutomationRunIgnored,
  prepareAutomationRun,
  resolveAutomationRunFailure,
} from "../openworkflow/shared/automation-run.js";
import { withOpenWorkflowRuntime } from "./openworkflow-test-support.js";
import { it } from "./test-context.js";

const TestTimeoutMs = 120_000;
const OpenAiAgentTargetConfig = {
  api_base_url: "https://api.openai.com/v1",
  binding_capabilities_by_connection_method: createOpenAiRawBindingCapabilitiesByConnectionMethod(),
};

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

async function seedOpenAiAgentBinding(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  suffix: string;
}) {
  const targetKey = `openai-agent-${input.suffix}`;
  const connectionId = `icn_openai_agent_${input.suffix}`;
  const bindingId = `ibd_openai_agent_${input.suffix}`;

  await input.db.insert(integrationTargets).values({
    targetKey,
    familyId: OpenAiApiKeyDefinition.familyId,
    variantId: OpenAiApiKeyDefinition.variantId,
    enabled: true,
    config: OpenAiAgentTargetConfig,
  });
  await input.db.insert(integrationConnections).values({
    id: connectionId,
    organizationId: input.organizationId,
    targetKey,
    displayName: "OpenAI agent connection",
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: "openai-agent-subject",
    config: {
      connection_method: "api-key",
    },
  });
  await input.db.insert(sandboxProfileVersions).values({
    sandboxProfileId: input.sandboxProfileId,
    version: input.sandboxProfileVersion,
  });
  await input.db.insert(sandboxProfileVersionIntegrationBindings).values({
    id: bindingId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    connectionId,
    kind: IntegrationBindingKinds.AGENT,
    config: {
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    },
  });
}

async function seedWebhookSource(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  sourceId: string;
  organizationId: string;
  connectionId: string;
  targetKey: string;
}) {
  await input.db.insert(integrationWebhookSources).values({
    id: input.sourceId,
    organizationId: input.organizationId,
    integrationConnectionId: input.connectionId,
    targetKey: input.targetKey,
    endpointKey: `${input.sourceId}-endpoint`,
    status: "active",
  });
}

describe("handleAutomationRun integration", () => {
  async function prepareAndHandoffAutomationRun(input: {
    db: ReturnType<typeof createControlPlaneDatabase>;
    automationRunId: string;
  }) {
    const workflowInput: HandleAutomationRunWorkflowInput = {
      automationRunId: input.automationRunId,
    };
    const transitionResult = await transitionAutomationRunToRunning(
      {
        db: input.db,
      },
      workflowInput,
    );
    if (!transitionResult.shouldProcess) {
      return null;
    }

    try {
      const preparedAutomationRun = await prepareAutomationRun(
        {
          db: input.db,
        },
        workflowInput,
      );
      const deliveryHandoff = await handoffAutomationRunDelivery(
        {
          db: input.db,
        },
        {
          preparedAutomationRun,
        },
      );
      return {
        ...preparedAutomationRun,
        deliveryTaskId: deliveryHandoff.deliveryTaskId,
      };
    } catch (error) {
      const failure = resolveAutomationRunFailure(error);
      await markAutomationRunFailed(
        {
          db: input.db,
        },
        {
          automationRunId: workflowInput.automationRunId,
          failureCode: failure.code,
          failureMessage: failure.message,
        },
      );
      throw error;
    }
  }

  it(
    "runs the workflow entrypoint and schedules conversation delivery",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_automation_workflow";
        const sandboxProfileId = "sbp_worker_automation_workflow";
        const automationId = "atm_worker_automation_workflow";
        const automationTargetId = "atg_worker_automation_workflow";
        const webhookEventId = "iwe_worker_automation_workflow";
        const automationRunId = "aru_worker_automation_workflow";
        const connectionId = "icn_worker_automation_workflow";
        const webhookSourceId = "iws_worker_automation_workflow";
        const targetKey = "github-cloud-worker-automation-workflow";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Workflow",
          slug: "worker-automation-workflow",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Workflow Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 4,
          suffix: "worker_automation_workflow",
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
          displayName: "Worker automation workflow connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "654321",
          config: {},
        });
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Workflow",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Reply to {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 4,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          externalEventId: "evt_automation_workflow",
          externalDeliveryId: "delivery_automation_workflow",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
          payload: {
            issue: {
              number: 27,
            },
            comment: {
              body: "ship it",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
          finalizedAt: "2026-03-09T00:00:01.000Z",
        });
        await database.db.insert(automationRuns).values({
          id: automationRunId,
          automationId,
          automationTargetId,
          sourceWebhookEventId: webhookEventId,
          status: AutomationRunStatuses.QUEUED,
        });

        await withOpenWorkflowRuntime({
          fixture,
          run: async ({ runtime, workflowContext }) => {
            workflowContext.openWorkflow.implementWorkflow(
              HandleAutomationRunWorkflow.spec,
              HandleAutomationRunWorkflow.fn,
            );
            const worker = workflowContext.openWorkflow.newWorker({
              concurrency: 1,
            });

            const handle = await workflowContext.openWorkflow.runWorkflow(
              HandleAutomationRunWorkflowSpec,
              {
                automationRunId,
              },
              {
                idempotencyKey: `handle-automation-run:${automationRunId}`,
              },
            );

            try {
              expect(await worker.tick()).toBe(1);
              await expect(handle.result({ timeoutMs: TestTimeoutMs })).resolves.toEqual({
                automationRunId,
              });

              const preparedAutomationRun = await database.db.query.automationRuns.findFirst({
                where: (table, { eq: whereEq }) => whereEq(table.id, automationRunId),
              });

              expect(preparedAutomationRun?.conversationId).toBeTruthy();

              const workflowRuns = await runtime.backend.listWorkflowRuns({
                limit: 20,
              });
              const deliveryRun = workflowRuns.data.find(
                (workflowRun) =>
                  workflowRun.workflowName ===
                    HandleAutomationConversationDeliveryWorkflowSpec.name &&
                  workflowRun.idempotencyKey ===
                    `automation-conversation-delivery:${preparedAutomationRun?.conversationId ?? ""}:1`,
              );

              expect(deliveryRun).toBeDefined();
              expect(deliveryRun?.status).toBe("pending");
            } finally {
              await worker.stop();
            }
          },
        });

        const persistedAutomationRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, automationRunId),
        });
        expect(persistedAutomationRun?.status).toBe(AutomationRunStatuses.RUNNING);
        expect(persistedAutomationRun?.conversationId).toBeTruthy();
        expect(persistedAutomationRun?.renderedInput).toBe("Reply to ship it");
        expect(persistedAutomationRun?.renderedConversationKey).toBe("issue-27");

        const deliveryProcessor =
          await database.db.query.automationConversationDeliveryProcessors.findFirst({
            where: (table, { eq: whereEq }) =>
              whereEq(table.conversationId, persistedAutomationRun?.conversationId ?? ""),
          });
        expect(deliveryProcessor).toMatchObject({
          conversationId: persistedAutomationRun?.conversationId,
          generation: 1,
          status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
          activeWorkflowRunId: null,
        });
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

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
        const webhookSourceId = "iws_worker_automation_prepare";
        const targetKey = "github-cloud-worker-automation-prepare";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Prepare",
          slug: "worker-automation-prepare",
        });
        await database.db.insert(users).values({
          id: "usr_automation_actor",
          name: "Automation Actor",
          email: "automation-actor@example.com",
          emailVerified: true,
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Prepare Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 7,
          suffix: "worker_automation_prepare",
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
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
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Handle {{payload.comment.body}}",
          instructions: "Always include a reproducible next step.",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 7,
          primaryRepositoryId: "mistlehq/platform",
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_prepare",
          externalDeliveryId: "delivery_prepare",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
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
          resolvedUserId: "usr_automation_actor",
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
        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedAutomationConversation =
          await database.db.query.automationConversations.findFirst({
            where: (table, { eq }) => eq(table.id, preparedRun.conversationId),
          });

        expect(preparedRun).toMatchObject({
          automationRunId,
          automationId,
          conversationId: expect.stringMatching(/^cnv_/),
          automationTargetId,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 7,
          primaryRepositoryId: "mistlehq/platform",
          webhookEventId,
          webhookEventType: "github.issue_comment.created",
          webhookProviderEventType: "issue_comment",
          webhookExternalEventId: "evt_prepare",
          webhookExternalDeliveryId: "delivery_prepare",
          webhookSourceOrderKey: "2026-03-09T00:00:00Z#0001",
          actingUserId: "usr_automation_actor",
          renderedInput: "Handle @mistlebot prepare",
          renderedConversationKey: "issue-777",
          renderedIdempotencyKey: "delivery_prepare",
          instructions: "Always include a reproducible next step.",
          collaborationModeSettings: {
            developerInstructions: "Always include a reproducible next step.",
          },
        });
        expect(preparedRun.webhookPayload).toEqual({
          issue: {
            number: 777,
          },
          comment: {
            body: "@mistlebot prepare",
          },
        });
        expect(persistedRun).toMatchObject({
          id: automationRunId,
          conversationId: preparedRun.conversationId,
          renderedInput: "Handle @mistlebot prepare",
          renderedConversationKey: "issue-777",
          renderedIdempotencyKey: "delivery_prepare",
          instructions: "Always include a reproducible next step.",
        });
        expect(persistedAutomationConversation).toMatchObject({
          id: preparedRun.conversationId,
          organizationId,
          ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: automationTargetId,
          createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
          createdById: webhookEventId,
          sandboxProfileId,
          integrationFamilyId: OpenAiApiKeyDefinition.familyId,
          runtimeId: "codex",
          conversationKey: "issue-777",
          status: AutomationConversationStatuses.PENDING,
        });
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "prepares Slack thread-grouped automations using the normalized thread root timestamp",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_slack_thread_prepare";
        const sandboxProfileId = "sbp_worker_slack_thread_prepare";
        const automationId = "atm_worker_slack_thread_prepare";
        const automationTargetId = "atg_worker_slack_thread_prepare";
        const webhookEventId = "iwe_worker_slack_thread_prepare";
        const automationRunId = "aru_worker_slack_thread_prepare";
        const connectionId = "icn_worker_slack_thread_prepare";
        const webhookSourceId = "iws_worker_slack_thread_prepare";
        const targetKey = "slack-default-worker-automation-prepare";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Slack Thread Prepare",
          slug: "worker-slack-thread-prepare",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Slack Thread Prepare Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 7,
          suffix: "worker_slack_thread_prepare",
        });
        await database.db.insert(integrationTargets).values({
          targetKey,
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            api_base_url: "https://slack.com/api",
          },
        });
        await database.db.insert(integrationConnections).values({
          id: connectionId,
          organizationId,
          targetKey,
          displayName: "Worker Slack automation connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {
            connection_method: "slack-bot-token",
          },
        });
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Slack Thread Prepare",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["slack:message"],
          payloadFilter: null,
          inputTemplate: "Handle {{payload.event.text}}",
          conversationKeyTemplate:
            "slack:thread:{{payload.event.channel}}:{{payload.event.mistle_thread_root_ts}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalEventId}}",
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
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_slack_thread_prepare",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
          providerEventType: "message",
          eventType: "slack:message",
          payload: {
            event: {
              channel: "C123",
              ts: "1710000000.000100",
              mistle_thread_root_ts: "1710000000.000100",
              text: "@mistlebot prepare",
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
        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });

        expect(preparedRun).toMatchObject({
          automationRunId,
          automationId,
          conversationId: expect.stringMatching(/^cnv_/),
          automationTargetId,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 7,
          webhookEventId,
          webhookEventType: "slack:message",
          webhookProviderEventType: "message",
          webhookExternalEventId: "evt_slack_thread_prepare",
          webhookExternalDeliveryId: null,
          webhookSourceOrderKey: "2026-03-09T00:00:00Z#0001",
          renderedInput: "Handle @mistlebot prepare",
          renderedConversationKey: "slack:thread:C123:1710000000.000100",
          renderedIdempotencyKey: "evt_slack_thread_prepare",
        });
        expect(persistedRun?.renderedConversationKey).toBe("slack:thread:C123:1710000000.000100");
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "prepares Slack automations when the input template uses an explicit Liquid fallback",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_slack_input_fallback_prepare";
        const sandboxProfileId = "sbp_worker_slack_input_fallback_prepare";
        const automationId = "atm_worker_slack_input_fallback_prepare";
        const automationTargetId = "atg_worker_slack_input_fallback_prepare";
        const webhookEventId = "iwe_worker_slack_input_fallback_prepare";
        const automationRunId = "aru_worker_slack_input_fallback_prepare";
        const connectionId = "icn_worker_slack_input_fallback_prepare";
        const webhookSourceId = "iws_worker_slack_input_fallback_prepare";
        const targetKey = "slack-default-worker-automation-input-fallback";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Slack Input Fallback Prepare",
          slug: "worker-slack-input-fallback-prepare",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Slack Input Fallback Prepare Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 3,
          suffix: "worker_slack_input_fallback_prepare",
        });
        await database.db.insert(integrationTargets).values({
          targetKey,
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            api_base_url: "https://slack.com/api",
          },
        });
        await database.db.insert(integrationConnections).values({
          id: connectionId,
          organizationId,
          targetKey,
          displayName: "Worker Slack input fallback connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "123456",
          config: {
            connection_method: "slack-bot-token",
          },
        });
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Slack Input Fallback Prepare",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["slack:message"],
          payloadFilter: null,
          inputTemplate:
            "Handle thread {{payload.event.thread_ts | default: payload.event.ts}}: {{payload.event.text}}",
          conversationKeyTemplate: "slack:channel:{{payload.event.channel}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalEventId}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 3,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_slack_input_fallback_prepare",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0002",
          providerEventType: "message",
          eventType: "slack:message",
          payload: {
            event: {
              channel: "C123",
              ts: "1710000000.000100",
              text: "@mistlebot prepare",
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
          renderedInput: "Handle thread 1710000000.000100: @mistlebot prepare",
          renderedConversationKey: "slack:channel:C123",
          renderedIdempotencyKey: "evt_slack_input_fallback_prepare",
        });
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "reuses the persisted rendered snapshot when replaying a running run",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_automation_replay_snapshot";
        const sandboxProfileId = "sbp_worker_automation_replay_snapshot";
        const automationId = "atm_worker_automation_replay_snapshot";
        const automationTargetId = "atg_worker_automation_replay_snapshot";
        const webhookEventId = "iwe_worker_automation_replay_snapshot";
        const automationRunId = "aru_worker_automation_replay_snapshot";
        const connectionId = "icn_worker_automation_replay_snapshot";
        const webhookSourceId = "iws_worker_automation_replay_snapshot";
        const targetKey = "github-cloud-worker-automation-replay-snapshot";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Replay Snapshot",
          slug: "worker-automation-replay-snapshot",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Replay Snapshot Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 5,
          suffix: "worker_automation_replay_snapshot",
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Replay Snapshot",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Handle {{payload.comment.body}}",
          instructions: "Mention the automation marker `AUTOMATION_ONLY` exactly once.",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
        });
        await database.db.insert(automationTargets).values({
          id: automationTargetId,
          automationId,
          sandboxProfileId,
          sandboxProfileVersion: 5,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_replay_snapshot",
          externalDeliveryId: "delivery_replay_snapshot",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0002",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 105,
            },
            comment: {
              body: "@mistlebot replay snapshot",
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

        const firstPreparedRun = await prepareAutomationRun(
          {
            db: database.db,
          },
          {
            automationRunId,
          },
        );

        await database.db
          .update(webhookAutomations)
          .set({
            inputTemplate: "Changed {{payload.comment.body}}",
            instructions: "Changed automation instructions should not replay.",
            conversationKeyTemplate: "changed-issue-{{payload.issue.number}}",
            idempotencyKeyTemplate: "changed-{{webhookEvent.externalDeliveryId}}",
          })
          .where(eq(webhookAutomations.automationId, automationId));

        const replayPreparedRun = await prepareAutomationRun(
          {
            db: database.db,
          },
          {
            automationRunId,
          },
        );
        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });

        expect(firstPreparedRun).toMatchObject({
          conversationId: expect.stringMatching(/^cnv_/),
          webhookSourceOrderKey: "2026-03-09T00:00:00Z#0002",
          renderedInput: "Handle @mistlebot replay snapshot",
          renderedConversationKey: "issue-105",
          renderedIdempotencyKey: "delivery_replay_snapshot",
          instructions: "Mention the automation marker `AUTOMATION_ONLY` exactly once.",
          collaborationModeSettings: {
            developerInstructions: "Mention the automation marker `AUTOMATION_ONLY` exactly once.",
          },
        });
        expect(replayPreparedRun).toEqual(firstPreparedRun);
        expect(persistedRun).toMatchObject({
          id: automationRunId,
          conversationId: firstPreparedRun.conversationId,
          renderedInput: "Handle @mistlebot replay snapshot",
          renderedConversationKey: "issue-105",
          renderedIdempotencyKey: "delivery_replay_snapshot",
          instructions: "Mention the automation marker `AUTOMATION_ONLY` exactly once.",
        });
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "enqueues delivery work and starts the processor for queued runs",
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
        const webhookSourceId = "iws_worker_automation_run_complete";
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
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          suffix: "worker_automation_run_complete",
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
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
          integrationWebhookSourceId: webhookSourceId,
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
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_complete",
          externalDeliveryId: "delivery_complete",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0003",
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

        const preparedAutomationRun = await prepareAndHandoffAutomationRun({
          db: database.db,
          automationRunId,
        });
        expect(preparedAutomationRun).not.toBeNull();

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedTask = await database.db.query.automationConversationDeliveryTasks.findFirst(
          {
            where: (table, { eq }) => eq(table.automationRunId, automationRunId),
          },
        );
        const persistedProcessor =
          await database.db.query.automationConversationDeliveryProcessors.findFirst({
            where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
          });
        const persistedRoute = await database.db.query.automationConversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.RUNNING);
        expect(persistedRun.startedAt).toBeDefined();
        expect(persistedRun.finishedAt).toBeNull();
        expect(persistedRun.failureCode).toBeNull();
        expect(persistedTask).toMatchObject({
          automationRunId,
          status: AutomationConversationDeliveryTaskStatuses.QUEUED,
          failureCode: null,
        });
        expect(persistedTask?.id).toBe(preparedAutomationRun?.deliveryTaskId);
        expect(persistedProcessor).toMatchObject({
          conversationId: persistedRun.conversationId,
          status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
        });
        expect(persistedRoute).toBeUndefined();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "hands off runs already in running status without requiring the queued transition",
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
        const webhookSourceId = "iws_worker_automation_run_running";
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
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          suffix: "worker_automation_run_running",
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
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
          integrationWebhookSourceId: webhookSourceId,
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
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_running",
          externalDeliveryId: "delivery_running",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0004",
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

        const preparedAutomationRun = await prepareAndHandoffAutomationRun({
          db: database.db,
          automationRunId,
        });
        expect(preparedAutomationRun).not.toBeNull();

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedTask = await database.db.query.automationConversationDeliveryTasks.findFirst(
          {
            where: (table, { eq }) => eq(table.automationRunId, automationRunId),
          },
        );
        const persistedProcessor =
          await database.db.query.automationConversationDeliveryProcessors.findFirst({
            where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
          });
        const persistedRoute = await database.db.query.automationConversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
        });
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.RUNNING);
        expect(persistedRun.finishedAt).toBeNull();
        expect(persistedRun.failureCode).toBeNull();
        expect(persistedTask).toMatchObject({
          automationRunId,
          status: AutomationConversationDeliveryTaskStatuses.QUEUED,
          failureCode: null,
        });
        expect(persistedProcessor).toMatchObject({
          conversationId: persistedRun.conversationId,
          status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
        });
        expect(persistedRoute).toBeUndefined();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "marks older queued runs ignored after a newer run already advanced the conversation",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_automation_run_ignore_stale";
        const sandboxProfileId = "sbp_worker_automation_run_ignore_stale";
        const automationId = "atm_worker_automation_run_ignore_stale";
        const automationTargetId = "atg_worker_automation_run_ignore_stale";
        const newerWebhookEventId = "iwe_worker_automation_run_ignore_stale_newer";
        const olderWebhookEventId = "iwe_worker_automation_run_ignore_stale_older";
        const newerAutomationRunId = "aru_worker_automation_run_ignore_stale_newer";
        const olderAutomationRunId = "aru_worker_automation_run_ignore_stale_older";
        const connectionId = "icn_worker_automation_run_ignore_stale";
        const webhookSourceId = "iws_worker_automation_run_ignore_stale";
        const targetKey = "github-cloud-worker-automation-run-ignore-stale";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Automation Ignore Stale",
          slug: "worker-automation-ignore-stale",
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Automation Ignore Stale Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          suffix: "worker_automation_run_ignore_stale",
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Ignore Stale",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
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
          id: newerWebhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_ignore_stale_newer",
          externalDeliveryId: "delivery_ignore_stale_newer",
          sourceOccurredAt: "2026-03-09T00:00:02.000Z",
          sourceOrderKey: "2026-03-09T00:00:02Z#0002",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 202,
            },
            comment: {
              body: "@mistlebot newer",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
        });
        await database.db.insert(automationRuns).values({
          id: newerAutomationRunId,
          automationId,
          automationTargetId,
          sourceWebhookEventId: newerWebhookEventId,
          status: AutomationRunStatuses.QUEUED,
        });

        const newerPreparedRun = await prepareAndHandoffAutomationRun({
          db: database.db,
          automationRunId: newerAutomationRunId,
        });
        expect(newerPreparedRun).not.toBeNull();

        if (newerPreparedRun === null) {
          throw new Error("Expected prepared automation run for stale ordering test.");
        }

        const persistedProcessor =
          await database.db.query.automationConversationDeliveryProcessors.findFirst({
            where: (table, { eq }) => eq(table.conversationId, newerPreparedRun.conversationId),
          });
        if (persistedProcessor === undefined) {
          throw new Error("Expected persisted conversation delivery processor.");
        }

        const newerTask = await claimOrResumeAutomationConversationDeliveryTask(
          {
            db: database.db,
          },
          {
            conversationId: newerPreparedRun.conversationId,
            generation: persistedProcessor.generation,
          },
        );
        if (newerTask === null) {
          throw new Error("Expected newer task to be claimable.");
        }
        expect(
          await resolveAutomationConversationDeliveryTaskAction(
            {
              db: database.db,
            },
            {
              taskId: newerTask.taskId,
              generation: persistedProcessor.generation,
            },
          ),
        ).toBe(AutomationConversationDeliveryTaskActions.DELIVER);

        await database.db
          .update(automationRuns)
          .set({
            status: AutomationRunStatuses.COMPLETED,
          })
          .where(eq(automationRuns.id, newerAutomationRunId));
        await finalizeAutomationConversationDeliveryTask(
          {
            db: database.db,
          },
          {
            taskId: newerTask.taskId,
            generation: persistedProcessor.generation,
            status: "completed",
          },
        );

        await database.db.insert(integrationWebhookEvents).values({
          id: olderWebhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_ignore_stale_older",
          externalDeliveryId: "delivery_ignore_stale_older",
          sourceOccurredAt: "2026-03-09T00:00:01.000Z",
          sourceOrderKey: "2026-03-09T00:00:01Z#0001",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 202,
            },
            comment: {
              body: "@mistlebot older",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
        });
        await database.db.insert(automationRuns).values({
          id: olderAutomationRunId,
          automationId,
          automationTargetId,
          sourceWebhookEventId: olderWebhookEventId,
          status: AutomationRunStatuses.QUEUED,
        });
        const olderPreparedRun = await prepareAndHandoffAutomationRun({
          db: database.db,
          automationRunId: olderAutomationRunId,
        });
        expect(olderPreparedRun).not.toBeNull();
        if (olderPreparedRun === null) {
          throw new Error("Expected older prepared automation run for stale ordering test.");
        }

        const claimedOlderTask = await claimOrResumeAutomationConversationDeliveryTask(
          {
            db: database.db,
          },
          {
            conversationId: newerPreparedRun.conversationId,
            generation: persistedProcessor.generation,
          },
        );
        if (claimedOlderTask === null) {
          throw new Error("Expected older task to be claimable.");
        }
        expect(
          await resolveAutomationConversationDeliveryTaskAction(
            {
              db: database.db,
            },
            {
              taskId: claimedOlderTask.taskId,
              generation: persistedProcessor.generation,
            },
          ),
        ).toBe(AutomationConversationDeliveryTaskActions.IGNORE);
        await markAutomationRunIgnored(
          {
            db: database.db,
          },
          {
            automationRunId: claimedOlderTask.automationRunId,
          },
        );
        await finalizeAutomationConversationDeliveryTask(
          {
            db: database.db,
          },
          {
            taskId: claimedOlderTask.taskId,
            generation: persistedProcessor.generation,
            status: "ignored",
          },
        );
        await idleAutomationConversationDeliveryProcessorIfEmpty(
          {
            db: database.db,
          },
          {
            conversationId: newerPreparedRun.conversationId,
            generation: persistedProcessor.generation,
          },
        );

        const newerRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, newerAutomationRunId),
        });
        const olderRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, olderAutomationRunId),
        });
        const olderTask = await database.db.query.automationConversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.automationRunId, olderAutomationRunId),
        });

        expect(newerRun).toBeDefined();
        expect(olderRun).toBeDefined();
        if (newerRun === undefined || olderRun === undefined) {
          throw new Error("Expected persisted automation runs.");
        }

        const conversation = await database.db.query.automationConversations.findFirst({
          where: (table, { eq }) => eq(table.id, newerRun.conversationId ?? ""),
        });

        expect(newerRun.status).toBe(AutomationRunStatuses.COMPLETED);
        expect(olderRun.status).toBe(AutomationRunStatuses.IGNORED);
        expect(olderTask).toMatchObject({
          automationRunId: olderAutomationRunId,
          status: AutomationConversationDeliveryTaskStatuses.IGNORED,
          failureCode: null,
          failureMessage: null,
        });
        expect(conversation).toMatchObject({
          id: newerRun.conversationId,
          lastProcessedSourceOrderKey: "2026-03-09T00:00:02Z#0002",
          lastProcessedWebhookEventId: newerWebhookEventId,
        });
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
        const webhookSourceId = "iws_worker_automation_run_fail";
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
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          suffix: "worker_automation_run_fail",
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
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
          integrationWebhookSourceId: webhookSourceId,
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
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_fail",
          externalDeliveryId: "delivery_fail",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0005",
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
          prepareAndHandoffAutomationRun({
            db: database.db,
            automationRunId,
          }),
        ).rejects.toThrow("undefined variable: payload.comment.missing_field");

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedTasks = await database.db.query.automationConversationDeliveryTasks.findMany(
          {
            where: (table, { eq }) => eq(table.automationRunId, automationRunId),
          },
        );
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.FAILED);
        expect(persistedRun.finishedAt).toBeDefined();
        expect(persistedRun.failureCode).toBe("template_render_failed");
        expect(persistedTasks).toHaveLength(0);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
