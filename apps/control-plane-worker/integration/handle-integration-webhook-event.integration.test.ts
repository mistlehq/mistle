import {
  automationTargets,
  automations,
  AutomationKinds,
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
  webhookAutomations,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import {
  createIntegrationRegistry,
  createOpenAiRawBindingCapabilitiesByConnectionMethod,
  OpenAiApiKeyDefinition,
  OpenAiReasoningEfforts,
} from "@mistle/integrations-definitions/server";
import { installInMemoryTracing } from "@mistle/telemetry/testing.js";
import { systemSleeper } from "@mistle/time";
import {
  HandleAutomationRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
  type HandleAutomationRunWorkflowInput,
} from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { beforeEach, describe, expect } from "vitest";

import { transitionAutomationRunToRunning } from "../openworkflow/handle-automation-run/transition-automation-run-to-running.js";
import { HandleAutomationRunWorkflow } from "../openworkflow/handle-automation-run/workflow.js";
import { markIntegrationWebhookEventFailed } from "../openworkflow/handle-integration-webhook-event/mark-integration-webhook-event-failed.js";
import { markIntegrationWebhookEventProcessed } from "../openworkflow/handle-integration-webhook-event/mark-integration-webhook-event-processed.js";
import { prepareIntegrationWebhookEvent } from "../openworkflow/handle-integration-webhook-event/prepare-integration-webhook-event.js";
import { HandleIntegrationWebhookEventWorkflow } from "../openworkflow/handle-integration-webhook-event/workflow.js";
import {
  markAutomationRunCompleted,
  markAutomationRunFailed,
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
const tracing = installInMemoryTracing();

function findWorkerSpan(input: { name: string }) {
  return tracing.getFinishedSpans().find((span) => span.name === input.name);
}

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
    pool,
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
      model: {
        defaultModel: "gpt-5.2",
        options: {
          reasoningEffort: OpenAiReasoningEfforts.MEDIUM,
        },
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

async function waitForBlockedWebhookEventMutation(input: {
  pool: Pool;
  minimumCount?: number;
}): Promise<void> {
  const minimumCount = input.minimumCount ?? 1;
  const deadlineMs = Date.now() + 10_000;

  while (Date.now() < deadlineMs) {
    const result = await input.pool.query<{ waiters: number }>(
      `
        select count(*)::int as waiters
        from pg_stat_activity
        where
          datname = current_database()
          and wait_event_type = 'Lock'
          and state = 'active'
          and query ilike '%integration_webhook_events%'
      `,
    );

    if ((result.rows[0]?.waiters ?? 0) >= minimumCount) {
      return;
    }

    await systemSleeper.sleep(50);
  }

  throw new Error(
    `Timed out waiting for ${String(minimumCount)} blocked webhook event mutation(s).`,
  );
}

describe("handleIntegrationWebhookEvent integration", () => {
  beforeEach(() => {
    tracing.reset();
  });

  async function executeHandleIntegrationWebhookEvent(input: {
    db: ReturnType<typeof createControlPlaneDatabase>;
    webhookEventId: string;
    enqueueAutomationRuns: (input: { automationRunIds: ReadonlyArray<string> }) => Promise<void>;
    enqueueResourceSync: (input: {
      organizationId: string;
      connectionId: string;
      kind: string;
    }) => Promise<void>;
  }) {
    const preparedWebhookEvent = await prepareIntegrationWebhookEvent(
      {
        db: input.db,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: input.webhookEventId,
      },
    );
    if (preparedWebhookEvent.finalized) {
      return {
        webhookEventId: input.webhookEventId,
      };
    }

    try {
      for (const resourceSyncRequest of preparedWebhookEvent.resourceSyncRequests) {
        await input.enqueueResourceSync(resourceSyncRequest);
      }
      if (preparedWebhookEvent.automationRunIds.length > 0) {
        await input.enqueueAutomationRuns({
          automationRunIds: preparedWebhookEvent.automationRunIds,
        });
      }
      await markIntegrationWebhookEventProcessed(
        {
          db: input.db,
        },
        {
          webhookEventId: input.webhookEventId,
        },
      );
    } catch (error) {
      await markIntegrationWebhookEventFailed(
        {
          db: input.db,
        },
        {
          webhookEventId: input.webhookEventId,
        },
      );
      throw error;
    }

    return {
      webhookEventId: input.webhookEventId,
    };
  }

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
    "runs the workflow entrypoint and schedules automation-run workflows",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_webhook_workflow";
        const targetKey = "github-cloud-worker-webhook-workflow";
        const connectionId = "icn_worker_webhook_workflow";
        const webhookSourceId = "iws_worker_webhook_workflow";
        const sandboxProfileId = "sbp_worker_webhook_workflow";
        const automationId = "atm_worker_webhook_workflow";
        const automationTargetId = "atg_worker_webhook_workflow";
        const webhookEventId = "iwe_worker_webhook_workflow";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Webhook Workflow",
          slug: "worker-webhook-workflow",
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
          displayName: "Worker webhook workflow connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "999999",
          config: {},
        });
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Worker Webhook Workflow Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 3,
          suffix: "worker_webhook_workflow",
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Worker Webhook Workflow Automation",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Respond to {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
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
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          externalEventId: "evt_webhook_workflow",
          externalDeliveryId: "delivery_webhook_workflow",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
          payload: {
            issue: {
              number: 14,
            },
            comment: {
              body: "launch",
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
        });

        await withOpenWorkflowRuntime({
          fixture,
          run: async ({ runtime, workflowContext }) => {
            workflowContext.openWorkflow.implementWorkflow(
              HandleIntegrationWebhookEventWorkflow.spec,
              HandleIntegrationWebhookEventWorkflow.fn,
            );
            const worker = workflowContext.openWorkflow.newWorker({
              concurrency: 1,
            });

            const handle = await workflowContext.openWorkflow.runWorkflow(
              HandleIntegrationWebhookEventWorkflowSpec,
              {
                webhookEventId,
              },
              {
                idempotencyKey: `handle-webhook:${webhookEventId}`,
              },
            );

            try {
              expect(await worker.tick()).toBe(1);
              await expect(handle.result({ timeoutMs: TestTimeoutMs })).resolves.toEqual({
                webhookEventId,
              });

              const queuedAutomationRun = await database.db.query.automationRuns.findFirst({
                where: (table, { eq: whereEq }) =>
                  whereEq(table.sourceWebhookEventId, webhookEventId),
              });
              expect(queuedAutomationRun?.id).toBeTruthy();

              const workflowRuns = await runtime.backend.listWorkflowRuns({
                limit: 20,
              });
              const automationRunWorkflow = workflowRuns.data.find(
                (workflowRun) =>
                  workflowRun.workflowName === HandleAutomationRunWorkflowSpec.name &&
                  workflowRun.idempotencyKey === queuedAutomationRun?.id,
              );

              expect(automationRunWorkflow).toBeDefined();
              expect(automationRunWorkflow?.status).toBe("pending");
            } finally {
              await worker.stop();
            }
          },
        });

        const persistedWebhookEvent = await database.db.query.integrationWebhookEvents.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, webhookEventId),
        });
        expect(persistedWebhookEvent?.status).toBe(IntegrationWebhookEventStatuses.PROCESSED);
        expect(persistedWebhookEvent?.finalizedAt).not.toBeNull();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "emits correlated webhook and delivery handoff spans across workflow boundaries",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_webhook_observability";
        const targetKey = "github-cloud-worker-webhook-observability";
        const connectionId = "icn_worker_webhook_observability";
        const webhookSourceId = "iws_worker_webhook_observability";
        const sandboxProfileId = "sbp_worker_webhook_observability";
        const automationId = "atm_worker_webhook_observability";
        const automationTargetId = "atg_worker_webhook_observability";
        const webhookEventId = "iwe_worker_webhook_observability";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Webhook Observability",
          slug: "worker-webhook-observability",
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
          displayName: "Worker webhook observability connection",
          status: IntegrationConnectionStatuses.ACTIVE,
          externalSubjectId: "github-installation-789",
          config: {
            connection_method: "github-app-installation",
            installation_id: "789",
          },
        });
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db
          .update(integrationWebhookSources)
          .set({ endpointKey: "worker-webhook-observability-endpoint" })
          .where(eq(integrationWebhookSources.id, webhookSourceId));
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Worker Webhook Observability Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 3,
          suffix: "worker-webhook-observability",
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Worker Webhook Observability Automation",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
          inputTemplate: "Respond to {{payload.comment.body}}",
          conversationKeyTemplate: "issue-{{payload.issue.number}}",
          idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
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
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          externalEventId: "evt_webhook_observability",
          externalDeliveryId: "delivery_webhook_observability",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0002",
          payload: {
            issue: {
              number: 21,
            },
            comment: {
              body: "launch observability",
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
        });

        await withOpenWorkflowRuntime({
          fixture,
          run: async ({ workflowContext }) => {
            workflowContext.openWorkflow.implementWorkflow(
              HandleIntegrationWebhookEventWorkflow.spec,
              HandleIntegrationWebhookEventWorkflow.fn,
            );
            workflowContext.openWorkflow.implementWorkflow(
              HandleAutomationRunWorkflow.spec,
              HandleAutomationRunWorkflow.fn,
            );
            const worker = workflowContext.openWorkflow.newWorker({
              concurrency: 1,
            });

            const webhookHandle = await workflowContext.openWorkflow.runWorkflow(
              HandleIntegrationWebhookEventWorkflowSpec,
              {
                webhookEventId,
              },
              {
                idempotencyKey: `handle-webhook-observability:${webhookEventId}`,
              },
            );

            try {
              expect(await worker.tick()).toBe(1);
              await expect(webhookHandle.result({ timeoutMs: TestTimeoutMs })).resolves.toEqual({
                webhookEventId,
              });

              expect(await worker.tick()).toBe(1);
            } finally {
              await worker.stop();
            }
          },
        });

        const queuedAutomationRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.sourceWebhookEventId, webhookEventId),
        });
        const persistedTask = await database.db.query.automationConversationDeliveryTasks.findFirst(
          {
            where: (table, { eq: whereEq }) => whereEq(table.sourceWebhookEventId, webhookEventId),
          },
        );

        expect(queuedAutomationRun).toBeDefined();
        expect(persistedTask).toBeDefined();
        if (queuedAutomationRun === undefined || persistedTask === undefined) {
          throw new Error("Expected queued automation run and delivery task.");
        }

        await tracing.forceFlush();

        const webhookStepSpan = findWorkerSpan({ name: "handle-webhook-event" });
        const handoffStepSpan = findWorkerSpan({ name: "handoff-automation-run-delivery" });

        expect(webhookStepSpan).toBeDefined();
        expect(webhookStepSpan?.attributes["mistle.webhook.event_id"]).toBe(webhookEventId);
        expect(webhookStepSpan?.attributes["mistle.integration.connection_id"]).toBe(connectionId);
        expect(webhookStepSpan?.attributes["mistle.integration.target_key"]).toBe(targetKey);
        expect(
          webhookStepSpan?.events.some((event) => event.name === "automation_run.schedule"),
        ).toBe(true);

        expect(handoffStepSpan).toBeDefined();
        expect(handoffStepSpan?.attributes["mistle.webhook.event_id"]).toBe(webhookEventId);
        expect(handoffStepSpan?.attributes["mistle.automation.run_id"]).toBe(
          queuedAutomationRun.id,
        );
        expect(handoffStepSpan?.attributes["mistle.integration.connection_id"]).toBe(connectionId);
        expect(handoffStepSpan?.attributes["mistle.integration.target_key"]).toBe(targetKey);
        expect(handoffStepSpan?.attributes["mistle.delivery.task_id"]).toBe(persistedTask.id);
        expect(handoffStepSpan?.events.some((event) => event.name === "delivery_task.queued")).toBe(
          true,
        );
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

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
        const webhookSourceId = "iws_worker_webhook_queue";
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Worker Queue Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 2,
          suffix: "worker_webhook_queue",
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
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: {
            "github.issue_comment.created": {
              op: "contains_token",
              path: ["comment", "body"],
              value: "@mistlebot",
            },
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
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_queue",
          externalDeliveryId: "delivery_queue",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
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

        const workflowOutput = await executeHandleIntegrationWebhookEvent({
          db: database.db,
          webhookEventId,
          enqueueAutomationRuns: async ({ automationRunIds }) => {
            for (const automationRunId of automationRunIds) {
              await executeHandleAutomationRunSteps({
                db: database.db,
                automationRunId,
              });
            }
          },
          enqueueResourceSync: async () => {},
        });

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
        const webhookSourceId = "iws_worker_webhook_ignore";
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
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

        const workflowOutput = await executeHandleIntegrationWebhookEvent({
          db: database.db,
          webhookEventId,
          enqueueAutomationRuns: async () => {},
          enqueueResourceSync: async () => {},
        });

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

  it(
    "ignores Slack message subtypes when an automation only listens for slack:message",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_slack_message_subtype_ignore";
        const targetKey = "slack-default-worker-message-subtype-ignore";
        const connectionId = "icn_worker_slack_message_subtype_ignore";
        const webhookSourceId = "iws_worker_slack_message_subtype_ignore";
        const webhookEventId = "iwe_worker_slack_message_subtype_ignore";
        const sandboxProfileId = "sbp_worker_slack_message_subtype_ignore";
        const automationId = "atm_worker_slack_message_subtype_ignore";
        const automationTargetId = "atg_worker_slack_message_subtype_ignore";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Slack Ignore Org",
          slug: "worker-slack-ignore-org",
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
          displayName: "Worker Slack webhook connection",
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
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Worker Slack Ignore Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 3,
          suffix: "worker_slack_message_subtype_ignore",
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Worker Slack message automation",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["slack:message"],
          payloadFilter: null,
          inputTemplate: "Respond to {{payload.event.text}}",
          conversationKeyTemplate: "channel-{{payload.event.channel}}",
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
          externalEventId: "evt_slack_message_deleted",
          providerEventType: "message_deleted",
          eventType: "slack:message_deleted",
          payload: {
            event: {
              channel: "C123",
              text: "deleted",
              subtype: "message_deleted",
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
        });

        const workflowOutput = await executeHandleIntegrationWebhookEvent({
          db: database.db,
          webhookEventId,
          enqueueAutomationRuns: async () => {},
          enqueueResourceSync: async () => {},
        });

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

  it(
    "marks webhook event processed when a resource sync trigger matches without automation targets",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const organizationId = "org_worker_webhook_resource_sync";
        const targetKey = "github-cloud-worker-webhook-resource-sync";
        const connectionId = "icn_worker_webhook_resource_sync";
        const webhookSourceId = "iws_worker_webhook_resource_sync";
        const webhookEventId = "iwe_worker_webhook_resource_sync";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Resource Sync Org",
          slug: "worker-resource-sync-org",
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
        await seedWebhookSource({
          db: database.db,
          sourceId: webhookSourceId,
          organizationId,
          connectionId,
          targetKey,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_resource_sync",
          externalDeliveryId: "delivery_resource_sync",
          providerEventType: "installation_repositories",
          eventType: "github.installation_repositories.added",
          payload: {
            installation: {
              id: 12345,
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
        });

        const workflowOutput = await executeHandleIntegrationWebhookEvent({
          db: database.db,
          webhookEventId,
          enqueueAutomationRuns: async () => {},
          enqueueResourceSync: async () => {},
        });

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
        expect(queuedRuns).toHaveLength(0);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "only allows one worker to prepare the same webhook event concurrently",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      const lockClient = database.pool.connect();

      try {
        const organizationId = "org_worker_webhook_prepare_race";
        const targetKey = "github-cloud-worker-webhook-prepare-race";
        const connectionId = "icn_worker_webhook_prepare_race";
        const webhookSourceId = "iws_worker_webhook_prepare_race";
        const sandboxProfileId = "sbp_worker_webhook_prepare_race";
        const automationId = "atm_worker_webhook_prepare_race";
        const automationTargetId = "atg_worker_webhook_prepare_race";
        const webhookEventId = "iwe_worker_webhook_prepare_race";

        await database.db.insert(organizations).values({
          id: organizationId,
          name: "Worker Webhook Prepare Race",
          slug: "worker-webhook-prepare-race",
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
          displayName: "Worker webhook prepare race connection",
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
        await database.db.insert(sandboxProfiles).values({
          id: sandboxProfileId,
          organizationId,
          displayName: "Worker Prepare Race Profile",
          status: "active",
        });
        await seedOpenAiAgentBinding({
          db: database.db,
          organizationId,
          sandboxProfileId,
          sandboxProfileVersion: 2,
          suffix: "worker_webhook_prepare_race",
        });
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Prepare Race Automation",
          enabled: true,
        });
        await database.db.insert(webhookAutomations).values({
          automationId,
          integrationWebhookSourceId: webhookSourceId,
          eventTypes: ["github.issue_comment.created"],
          payloadFilter: null,
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
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
          integrationWebhookSourceId: webhookSourceId,
          targetKey,
          externalEventId: "evt_prepare_race",
          externalDeliveryId: "delivery_prepare_race",
          sourceOccurredAt: "2026-03-09T00:00:00.000Z",
          sourceOrderKey: "2026-03-09T00:00:00Z#0001",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            installation: {
              id: 12345,
            },
            delivery: {
              id: "delivery_prepare_race_payload",
            },
            comment: {
              body: "please run @mistlebot",
            },
          },
          status: IntegrationWebhookEventStatuses.RECEIVED,
        });

        const acquiredLockClient = await lockClient;
        await acquiredLockClient.query("BEGIN");
        await acquiredLockClient.query(
          `
            select 1
            from "control_plane"."integration_webhook_events"
            where id = $1
            for update
          `,
          [webhookEventId],
        );

        const firstPreparePromise = prepareIntegrationWebhookEvent(
          {
            db: database.db,
            integrationRegistry: createIntegrationRegistry(),
          },
          {
            webhookEventId,
          },
        );
        const secondPreparePromise = prepareIntegrationWebhookEvent(
          {
            db: database.db,
            integrationRegistry: createIntegrationRegistry(),
          },
          {
            webhookEventId,
          },
        );

        await waitForBlockedWebhookEventMutation({
          pool: database.pool,
          minimumCount: 2,
        });

        await acquiredLockClient.query("COMMIT");

        const prepareResults = await Promise.all([firstPreparePromise, secondPreparePromise]);
        const finalizedResults = prepareResults.filter((result) => result.finalized);
        const activeResults = prepareResults.filter((result) => !result.finalized);

        expect(finalizedResults).toHaveLength(1);
        expect(finalizedResults[0]).toEqual({
          automationRunIds: [],
          finalized: true,
          resourceSyncRequests: [],
          webhookEventId,
        });
        expect(activeResults).toHaveLength(1);
        expect(activeResults[0]?.automationRunIds).toHaveLength(1);
        expect(activeResults[0]?.resourceSyncRequests).toEqual([]);

        const persistedEvent = await database.db.query.integrationWebhookEvents.findFirst({
          where: (table, { eq }) => eq(table.id, webhookEventId),
        });
        expect(persistedEvent?.status).toBe(IntegrationWebhookEventStatuses.PROCESSING);

        const queuedRuns = await database.db.query.automationRuns.findMany({
          where: (table, { eq }) => eq(table.sourceWebhookEventId, webhookEventId),
        });
        expect(queuedRuns).toHaveLength(1);
      } finally {
        const acquiredLockClient = await lockClient;
        try {
          await acquiredLockClient.query("ROLLBACK");
        } catch {}
        acquiredLockClient.release();
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
