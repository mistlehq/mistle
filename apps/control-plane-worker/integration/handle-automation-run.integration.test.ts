import {
  ConversationDeliveryProcessorStatuses,
  ConversationDeliveryTaskStatuses,
  automationRuns,
  AutomationRunStatuses,
  automationTargets,
  automations,
  AutomationKinds,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  ConversationStatuses,
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
  createOpenAiRawBindingCapabilities,
  OpenAiApiKeyDefinition,
  OpenAiReasoningEfforts,
  OpenAiRuntimes,
} from "@mistle/integrations-definitions";
import type { HandleAutomationRunWorkflowInput } from "@mistle/workflows/control-plane";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";
import { type RawData, WebSocketServer } from "ws";

import {
  handoffAutomationRunDelivery,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "../src/runtime/services/handle-automation-run.js";
import {
  acquireConversationDeliveryConnection,
  claimOrResumeConversationDeliveryTask,
  completeConversationDeliveryAutomationRun,
  deliverConversationAutomationPayload,
  ensureConversationDeliverySandbox,
  failConversationDeliveryAutomationRun,
  finalizeConversationDeliveryActiveTask,
  idleConversationDeliveryProcessor,
  prepareConversationDeliveryAutomationRun,
  resolveAutomationRunFailure as resolveConversationDeliveryFailure,
} from "../src/runtime/services/handle-conversation-delivery.js";
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

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type AgentDeliveryTestServer = {
  url: string;
  payload: Promise<string>;
  close: () => Promise<void>;
};

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }

      resolveFn(value);
    },
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }

      rejectFn(reason);
    },
  };
}

function toText(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function parseRequestIdFromConnectMessage(data: RawData): string {
  const payloadText = toText(data);
  const parsedPayload: unknown = JSON.parse(payloadText);
  if (
    typeof parsedPayload !== "object" ||
    parsedPayload === null ||
    Array.isArray(parsedPayload) ||
    !("type" in parsedPayload) ||
    parsedPayload.type !== "connect" ||
    !("requestId" in parsedPayload) ||
    typeof parsedPayload.requestId !== "string" ||
    !("channel" in parsedPayload) ||
    typeof parsedPayload.channel !== "object" ||
    parsedPayload.channel === null ||
    !("kind" in parsedPayload.channel) ||
    parsedPayload.channel.kind !== "agent"
  ) {
    throw new Error("Expected a sandbox agent connect request payload.");
  }

  return parsedPayload.requestId;
}

async function startAgentDeliveryTestServer(): Promise<AgentDeliveryTestServer> {
  const payloadDeferred = createDeferred<string>();
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", resolve);
    wsServer.once("error", reject);
  });

  wsServer.on("connection", (socket) => {
    let didHandleConnect = false;

    socket.on("message", (message) => {
      if (!didHandleConnect) {
        didHandleConnect = true;
        const requestId = parseRequestIdFromConnectMessage(message);
        socket.send(
          JSON.stringify({
            type: "connect.ok",
            requestId,
          }),
        );
        return;
      }

      payloadDeferred.resolve(toText(message));
    });

    socket.on("error", (error) => {
      payloadDeferred.reject(error);
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a socket address.");
  }

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    payload: payloadDeferred.promise,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
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
    const transitionResult = await transitionAutomationRunToRunning(
      {
        db: input.db,
      },
      workflowInput,
    );
    if (!transitionResult.shouldProcess) {
      return;
    }

    const deliveryServer = await startAgentDeliveryTestServer();

    try {
      const preparedAutomationRun = await prepareAutomationRun(
        {
          db: input.db,
        },
        workflowInput,
      );
      await handoffAutomationRunDelivery(
        {
          db: input.db,
          enqueueConversationDeliveryWorkflow: async () => {},
        },
        {
          preparedAutomationRun,
        },
      );

      const persistedProcessor = await input.db.query.conversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, preparedAutomationRun.conversationId),
      });
      if (persistedProcessor === undefined) {
        throw new Error("Expected persisted conversation delivery processor.");
      }

      while (true) {
        const activeTask = await claimOrResumeConversationDeliveryTask(
          {
            db: input.db,
          },
          {
            conversationId: preparedAutomationRun.conversationId,
            generation: persistedProcessor.generation,
          },
        );

        if (activeTask === null) {
          const didIdleProcessor = await idleConversationDeliveryProcessor(
            {
              db: input.db,
            },
            {
              conversationId: preparedAutomationRun.conversationId,
              generation: persistedProcessor.generation,
            },
          );
          if (didIdleProcessor) {
            break;
          }

          continue;
        }

        try {
          const preparedTaskRun = await prepareConversationDeliveryAutomationRun(
            {
              db: input.db,
            },
            {
              automationRunId: activeTask.automationRunId,
            },
          );
          const ensuredSandbox = await ensureConversationDeliverySandbox(
            {
              db: input.db,
              startSandboxProfileInstance: async () => ({
                workflowRunId: "wf_start_sandbox_test",
                sandboxInstanceId: "sbi_test",
              }),
            },
            {
              preparedAutomationRun: preparedTaskRun,
            },
          );
          const acquiredConnection = await acquireConversationDeliveryConnection(
            {
              getSandboxInstance: async () => ({
                id: "sbi_test",
                status: "running",
                failureCode: null,
                failureMessage: null,
              }),
              mintSandboxConnectionToken: async () => ({
                instanceId: "sbi_test",
                url: deliveryServer.url,
                token: "connect_token_test",
                expiresAt: "2026-03-09T00:00:30.000Z",
              }),
            },
            {
              preparedAutomationRun: preparedTaskRun,
              ensuredAutomationSandbox: ensuredSandbox,
            },
          );

          await deliverConversationAutomationPayload(
            {
              db: input.db,
            },
            {
              taskId: activeTask.taskId,
              generation: persistedProcessor.generation,
              preparedAutomationRun: preparedTaskRun,
              ensuredAutomationSandbox: ensuredSandbox,
              acquiredAutomationConnection: acquiredConnection,
            },
          );

          await completeConversationDeliveryAutomationRun(
            {
              db: input.db,
            },
            {
              automationRunId: activeTask.automationRunId,
            },
          );

          await finalizeConversationDeliveryActiveTask(
            {
              db: input.db,
            },
            {
              taskId: activeTask.taskId,
              generation: persistedProcessor.generation,
              status: "completed",
            },
          );
        } catch (error) {
          const failure = resolveConversationDeliveryFailure({
            error,
          });
          await failConversationDeliveryAutomationRun(
            {
              db: input.db,
            },
            {
              automationRunId: activeTask.automationRunId,
              failureCode: failure.code,
              failureMessage: failure.message,
            },
          );
          await finalizeConversationDeliveryActiveTask(
            {
              db: input.db,
            },
            {
              taskId: activeTask.taskId,
              generation: persistedProcessor.generation,
              status: "failed",
              failureCode: failure.code,
              failureMessage: failure.message,
            },
          );
        }
      }

      await deliveryServer.payload;
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
    } finally {
      await deliveryServer.close();
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
        const persistedConversation = await database.db.query.conversations.findFirst({
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
          webhookEventId,
          webhookEventType: "github.issue_comment.created",
          webhookProviderEventType: "issue_comment",
          webhookExternalEventId: "evt_prepare",
          webhookExternalDeliveryId: "delivery_prepare",
          webhookSourceOrderKey: "2026-03-09T00:00:00Z#0001",
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
        expect(persistedRun).toMatchObject({
          id: automationRunId,
          conversationId: preparedRun.conversationId,
          renderedInput: "Handle @mistlebot prepare",
          renderedConversationKey: "issue-777",
          renderedIdempotencyKey: "delivery_prepare",
        });
        expect(persistedConversation).toMatchObject({
          id: preparedRun.conversationId,
          organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: webhookEventId,
          sandboxProfileId,
          integrationFamilyId: OpenAiApiKeyDefinition.familyId,
          conversationKey: "issue-777",
          preview: "Handle @mistlebot prepare",
          status: ConversationStatuses.PENDING,
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
        await database.db.insert(automations).values({
          id: automationId,
          organizationId,
          kind: AutomationKinds.WEBHOOK,
          name: "Automation Replay Snapshot",
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
          sandboxProfileVersion: 5,
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: webhookEventId,
          organizationId,
          integrationConnectionId: connectionId,
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
        });
        expect(replayPreparedRun).toEqual(firstPreparedRun);
        expect(persistedRun).toMatchObject({
          id: automationRunId,
          conversationId: firstPreparedRun.conversationId,
          renderedInput: "Handle @mistlebot replay snapshot",
          renderedConversationKey: "issue-105",
          renderedIdempotencyKey: "delivery_replay_snapshot",
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

        await executeHandleAutomationRunSteps({
          db: database.db,
          automationRunId,
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedTask = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.automationRunId, automationRunId),
        });
        const persistedProcessor = await database.db.query.conversationDeliveryProcessors.findFirst(
          {
            where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
          },
        );
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.COMPLETED);
        expect(persistedRun.startedAt).toBeDefined();
        expect(persistedRun.finishedAt).toBeDefined();
        expect(persistedRun.failureCode).toBeNull();
        expect(persistedTask).toMatchObject({
          automationRunId,
          status: ConversationDeliveryTaskStatuses.COMPLETED,
          failureCode: null,
        });
        expect(persistedProcessor).toMatchObject({
          conversationId: persistedRun.conversationId,
          status: ConversationDeliveryProcessorStatuses.IDLE,
        });
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

        await executeHandleAutomationRunSteps({
          db: database.db,
          automationRunId,
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedTask = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq }) => eq(table.automationRunId, automationRunId),
        });
        const persistedProcessor = await database.db.query.conversationDeliveryProcessors.findFirst(
          {
            where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
          },
        );
        expect(persistedRun).toBeDefined();
        if (persistedRun === undefined) {
          throw new Error("Expected persisted automation run.");
        }

        expect(persistedRun.status).toBe(AutomationRunStatuses.COMPLETED);
        expect(persistedRun.finishedAt).toBeDefined();
        expect(persistedRun.failureCode).toBeNull();
        expect(persistedTask).toMatchObject({
          automationRunId,
          status: ConversationDeliveryTaskStatuses.COMPLETED,
          failureCode: null,
        });
        expect(persistedProcessor).toMatchObject({
          conversationId: persistedRun.conversationId,
          status: ConversationDeliveryProcessorStatuses.IDLE,
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
          executeHandleAutomationRunSteps({
            db: database.db,
            automationRunId,
          }),
        ).rejects.toThrowError("undefined variable: payload.comment.missing_field");

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, automationRunId),
        });
        const persistedTasks = await database.db.query.conversationDeliveryTasks.findMany({
          where: (table, { eq }) => eq(table.automationRunId, automationRunId),
        });
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
