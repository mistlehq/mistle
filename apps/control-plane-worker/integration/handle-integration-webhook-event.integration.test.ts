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
  createOpenAiRawBindingCapabilities,
  OpenAiApiKeyDefinition,
  OpenAiReasoningEfforts,
  OpenAiRuntimes,
} from "@mistle/integrations-definitions";
import {
  HandleAutomationRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
  type HandleAutomationRunWorkflowInput,
} from "@mistle/workflow-registry/control-plane";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { transitionAutomationRunToRunning } from "../openworkflow/handle-automation-run/transition-automation-run-to-running.js";
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
  binding_capabilities: createOpenAiRawBindingCapabilities(),
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
      auth_scheme: "api-key",
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
      runtime: OpenAiRuntimes.CODEX_CLI,
      defaultModel: "gpt-5.2",
      reasoningEffort: OpenAiReasoningEfforts.MEDIUM,
    },
  });
}

describe("handleIntegrationWebhookEvent integration", () => {
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
          integrationConnectionId: connectionId,
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
          displayName: "Worker webhook connection",
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
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
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
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
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
});
