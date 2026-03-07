import {
  automationRuns,
  AutomationRunStatuses,
  automationTargets,
  automations,
  AutomationKinds,
  conversationRoutes,
  createControlPlaneDatabase,
  integrationConnections,
  IntegrationConnectionStatuses,
  IntegrationBindingKinds,
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
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";
import type { RawData } from "ws";
import { WebSocketServer } from "ws";

import {
  claimAutomationConversation,
  ensureAutomationConversationBinding,
  ensureAutomationConversationRoute,
  ensureAutomationConversationSandbox,
  executeAutomationConversation,
  markAutomationRunCompleted,
  markAutomationRunFailed,
  persistAutomationConversationExecution,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "../src/runtime/services/handle-automation-run.js";
import { it } from "./test-context.js";

const TestTimeoutMs = 120_000;

type JsonRpcRequest = {
  id: string | number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse =
  | {
      result: unknown;
    }
  | {
      error: {
        code: number;
        message: string;
      };
    };

type CodexTestServer = {
  url: string;
  requests: JsonRpcRequest[];
  close: () => Promise<void>;
};

function toText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function startCodexTestServer(
  handler: (request: JsonRpcRequest) => JsonRpcResponse,
): Promise<CodexTestServer> {
  const requests: JsonRpcRequest[] = [];
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (socket) => {
    let connected = false;

    socket.on("message", (rawData) => {
      const messageText = toText(rawData);
      let parsedMessage: unknown;
      try {
        parsedMessage = JSON.parse(messageText);
      } catch {
        return;
      }

      if (!isRecord(parsedMessage)) {
        return;
      }

      if (!connected) {
        const typeValue = parsedMessage.type;
        const requestIdValue = parsedMessage.requestId;
        if (typeValue !== "connect" || typeof requestIdValue !== "string") {
          return;
        }

        connected = true;
        socket.send(
          JSON.stringify({
            type: "connect.ok",
            requestId: requestIdValue,
          }),
        );
        return;
      }

      const methodValue = parsedMessage.method;
      const idValue = parsedMessage.id;
      if (
        typeof methodValue !== "string" ||
        !(typeof idValue === "string" || typeof idValue === "number")
      ) {
        return;
      }

      const request: JsonRpcRequest = {
        id: idValue,
        method: methodValue,
      };
      if ("params" in parsedMessage) {
        request.params = parsedMessage.params;
      }
      requests.push(request);

      if (request.method === "initialize") {
        socket.send(
          JSON.stringify({
            id: idValue,
            result: {
              userAgent: "mistle-codex-test-server",
            },
          }),
        );
        return;
      }

      const response = handler(request);
      if ("error" in response) {
        socket.send(
          JSON.stringify({
            id: idValue,
            error: response.error,
          }),
        );
        return;
      }

      socket.send(
        JSON.stringify({
          id: idValue,
          result: response.result,
        }),
      );
    });
  });

  const address = wsServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected websocket server to expose a numeric port.");
  }

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    requests,
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

async function seedAutomationScenario(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  suffix: string;
}): Promise<{
  organizationId: string;
  automationId: string;
  automationTargetId: string;
  sandboxProfileId: string;
  sourceConnectionId: string;
  runId: string;
  eventId: string;
}> {
  const organizationId = `org_worker_automation_route_${input.suffix}`;
  const sandboxProfileId = `sbp_worker_automation_route_${input.suffix}`;
  const automationId = `atm_worker_automation_route_${input.suffix}`;
  const automationTargetId = `atg_worker_automation_route_${input.suffix}`;
  const sourceConnectionId = `icn_worker_automation_route_source_${input.suffix}`;
  const eventId = `iwe_worker_automation_route_${input.suffix}`;
  const runId = `aru_worker_automation_route_${input.suffix}`;

  await input.db.insert(organizations).values({
    id: organizationId,
    name: `Worker Automation Route ${input.suffix}`,
    slug: `worker-automation-route-${input.suffix}`,
  });
  await input.db.insert(sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Automation Route ${input.suffix}`,
    status: "active",
  });
  await input.db.insert(sandboxProfileVersions).values({
    sandboxProfileId,
    version: 1,
  });

  await input.db.insert(integrationTargets).values({
    targetKey: `openai-default-worker-automation-route-${input.suffix}`,
    familyId: "openai",
    variantId: "openai-default",
    enabled: true,
    config: {
      api_base_url: "https://api.openai.com",
      web_base_url: "https://platform.openai.com",
    },
  });
  await input.db.insert(integrationConnections).values({
    id: `icn_worker_automation_route_agent_${input.suffix}`,
    organizationId,
    targetKey: `openai-default-worker-automation-route-${input.suffix}`,
    displayName: "Worker automation route agent",
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: "900001",
    config: {},
  });
  await input.db.insert(sandboxProfileVersionIntegrationBindings).values({
    id: `ibd_worker_automation_route_${input.suffix}`,
    sandboxProfileId,
    sandboxProfileVersion: 1,
    connectionId: `icn_worker_automation_route_agent_${input.suffix}`,
    kind: IntegrationBindingKinds.AGENT,
    config: {
      defaultModel: "gpt-5.3-codex",
    },
  });

  await input.db.insert(integrationTargets).values({
    targetKey: `github-cloud-worker-automation-route-${input.suffix}`,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.db.insert(integrationConnections).values({
    id: sourceConnectionId,
    organizationId,
    targetKey: `github-cloud-worker-automation-route-${input.suffix}`,
    displayName: "Worker automation route webhook source",
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: "900002",
    config: {},
  });

  await input.db.insert(automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Automation Route ${input.suffix}`,
    enabled: true,
  });
  await input.db.insert(webhookAutomations).values({
    automationId,
    integrationConnectionId: sourceConnectionId,
    eventTypes: ["github.issue_comment.created"],
    payloadFilter: null,
    inputTemplate: "Handle {{payload.comment.body}}",
    conversationKeyTemplate: "issue-{{payload.issue.number}}",
    idempotencyKeyTemplate: null,
  });
  await input.db.insert(automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });

  await input.db.insert(integrationWebhookEvents).values({
    id: eventId,
    organizationId,
    integrationConnectionId: sourceConnectionId,
    targetKey: `github-cloud-worker-automation-route-${input.suffix}`,
    externalEventId: `evt_worker_automation_route_${input.suffix}`,
    externalDeliveryId: `delivery_worker_automation_route_${input.suffix}`,
    providerEventType: "issue_comment",
    eventType: "github.issue_comment.created",
    payload: {
      issue: {
        number: 42,
      },
      comment: {
        body: "@mistlebot run",
      },
    },
    status: IntegrationWebhookEventStatuses.PROCESSED,
  });
  await input.db.insert(automationRuns).values({
    id: runId,
    automationId,
    automationTargetId,
    sourceWebhookEventId: eventId,
    status: AutomationRunStatuses.QUEUED,
  });

  return {
    organizationId,
    automationId,
    automationTargetId,
    sandboxProfileId,
    sourceConnectionId,
    runId,
    eventId,
  };
}

async function seedFollowupAutomationRun(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  suffix: string;
  automationId: string;
  automationTargetId: string;
  organizationId: string;
  sourceConnectionId: string;
}): Promise<{ runId: string; eventId: string }> {
  const eventId = `iwe_worker_automation_route_followup_${input.suffix}`;
  const runId = `aru_worker_automation_route_followup_${input.suffix}`;

  await input.db.insert(integrationWebhookEvents).values({
    id: eventId,
    organizationId: input.organizationId,
    integrationConnectionId: input.sourceConnectionId,
    targetKey: `github-cloud-worker-automation-route-${input.suffix}`,
    externalEventId: `evt_worker_automation_route_followup_${input.suffix}`,
    externalDeliveryId: `delivery_worker_automation_route_followup_${input.suffix}`,
    providerEventType: "issue_comment",
    eventType: "github.issue_comment.created",
    payload: {
      issue: {
        number: 42,
      },
      comment: {
        body: "@mistlebot run again",
      },
    },
    status: IntegrationWebhookEventStatuses.PROCESSED,
  });
  await input.db.insert(automationRuns).values({
    id: runId,
    automationId: input.automationId,
    automationTargetId: input.automationTargetId,
    sourceWebhookEventId: eventId,
    status: AutomationRunStatuses.QUEUED,
  });

  return {
    runId,
    eventId,
  };
}

async function executeAutomationConversationRun(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  automationRunId: string;
  startSandboxProfileInstance: (payload: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    startedBy: {
      kind: "user" | "system";
      id: string;
    };
    source: "dashboard" | "webhook";
  }) => Promise<{
    workflowRunId: string;
    sandboxInstanceId: string;
  }>;
  getSandboxInstance: (payload: { organizationId: string; instanceId: string }) => Promise<{
    id: string;
    status: "starting" | "running" | "stopped" | "failed";
    failureCode: string | null;
    failureMessage: string | null;
  }>;
  mintSandboxConnectionToken: (payload: { organizationId: string; instanceId: string }) => Promise<{
    instanceId: string;
    url: string;
    token: string;
    expiresAt: string;
  }>;
}): Promise<void> {
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

  try {
    const preparedAutomationRun = await prepareAutomationRun(
      {
        db: input.db,
      },
      workflowInput,
    );
    const claimedAutomationConversation = await claimAutomationConversation(
      {
        db: input.db,
      },
      {
        preparedAutomationRun,
      },
    );
    const ensuredAutomationConversationSandbox = await ensureAutomationConversationSandbox(
      {
        db: input.db,
        startSandboxProfileInstance: input.startSandboxProfileInstance,
        getSandboxInstance: input.getSandboxInstance,
      },
      {
        preparedAutomationRun,
        claimedAutomationConversation,
      },
    );
    const routedAutomationConversation = await ensureAutomationConversationRoute(
      {
        db: input.db,
      },
      {
        preparedAutomationRun,
        claimedAutomationConversation,
        ensuredAutomationConversationSandbox,
      },
    );
    const boundAutomationConversation = await ensureAutomationConversationBinding(
      {
        db: input.db,
        mintSandboxConnectionToken: input.mintSandboxConnectionToken,
      },
      {
        preparedAutomationRun,
        claimedAutomationConversation,
        routedAutomationConversation,
      },
    );
    const executedAutomationConversation = await executeAutomationConversation(
      {
        mintSandboxConnectionToken: input.mintSandboxConnectionToken,
      },
      {
        preparedAutomationRun,
        boundAutomationConversation,
      },
    );
    await persistAutomationConversationExecution(
      {
        db: input.db,
      },
      {
        preparedAutomationRun,
        boundAutomationConversation,
        executedAutomationConversation,
      },
    );
    await markAutomationRunCompleted(
      {
        db: input.db,
      },
      workflowInput,
    );
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

describe("handleAutomationRun conversation routing integration", () => {
  it(
    "creates provider conversation on first run and steers existing active execution on second run",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      const rpcServer = await startCodexTestServer((request) => {
        if (request.method === "thread/start") {
          return {
            result: {
              thread: {
                id: "thread_route_001",
              },
            },
          };
        }

        if (request.method === "turn/start") {
          return {
            result: {
              turn: {
                id: "turn_route_001",
              },
            },
          };
        }

        if (request.method === "thread/read") {
          return {
            result: {
              thread: {
                id: "thread_route_001",
                status: {
                  type: "active",
                },
              },
            },
          };
        }

        if (request.method === "turn/steer") {
          return {
            result: {
              turnId: "turn_route_002",
            },
          };
        }

        return {
          error: {
            code: -32601,
            message: `Unsupported method '${request.method}'.`,
          },
        };
      });

      let sandboxStartCount = 0;

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "first-second",
        });

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: seeded.runId,
          startSandboxProfileInstance: async () => {
            sandboxStartCount += 1;
            return {
              workflowRunId: `wfr_route_${String(sandboxStartCount)}`,
              sandboxInstanceId: `sbi_route_${String(sandboxStartCount)}`,
            };
          },
          getSandboxInstance: async ({ instanceId }) => ({
            id: instanceId,
            status: "running",
            failureCode: null,
            failureMessage: null,
          }),
          mintSandboxConnectionToken: async ({ instanceId }) => ({
            instanceId,
            url: rpcServer.url,
            token: "token_route",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const followup = await seedFollowupAutomationRun({
          db: database.db,
          suffix: "first-second",
          automationId: seeded.automationId,
          automationTargetId: seeded.automationTargetId,
          organizationId: seeded.organizationId,
          sourceConnectionId: seeded.sourceConnectionId,
        });

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: followup.runId,
          startSandboxProfileInstance: async () => {
            sandboxStartCount += 1;
            return {
              workflowRunId: `wfr_route_${String(sandboxStartCount)}`,
              sandboxInstanceId: `sbi_route_${String(sandboxStartCount)}`,
            };
          },
          getSandboxInstance: async ({ instanceId }) => ({
            id: instanceId,
            status: "running",
            failureCode: null,
            failureMessage: null,
          }),
          mintSandboxConnectionToken: async ({ instanceId }) => ({
            instanceId,
            url: rpcServer.url,
            token: "token_route",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        expect(sandboxStartCount).toBe(1);

        const persistedConversation = await database.db.query.conversations.findFirst({
          where: (table, { eq }) => eq(table.organizationId, seeded.organizationId),
        });
        expect(persistedConversation).toBeDefined();
        if (persistedConversation === undefined) {
          throw new Error("Expected conversation row.");
        }

        const persistedRoute = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.conversationId, persistedConversation.id),
        });
        expect(persistedRoute).toBeDefined();
        if (persistedRoute === undefined) {
          throw new Error("Expected conversation route row.");
        }

        expect(persistedRoute.providerConversationId).toBe("thread_route_001");
        expect(persistedRoute.providerExecutionId).toBe("turn_route_002");

        const methodNames = rpcServer.requests
          .map((request) => request.method)
          .filter((methodName) => methodName !== "initialize");
        expect(methodNames).toEqual(["thread/start", "turn/start", "thread/read", "turn/steer"]);
      } finally {
        await rpcServer.close();
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "resumes idle codex conversations with thread/resume before turn/start",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      const rpcServer = await startCodexTestServer((request) => {
        if (request.method === "thread/start") {
          return {
            result: {
              thread: {
                id: "thread_idle_resume_001",
              },
            },
          };
        }

        if (request.method === "turn/start") {
          const runTurnId =
            request.params !== undefined && isRecord(request.params) && "threadId" in request.params
              ? "turn_idle_resume_001"
              : "turn_idle_resume_002";
          return {
            result: {
              turn: {
                id: runTurnId,
              },
            },
          };
        }

        if (request.method === "thread/read") {
          return {
            result: {
              thread: {
                id: "thread_idle_resume_001",
                status: {
                  type: "idle",
                },
              },
            },
          };
        }

        if (request.method === "thread/resume") {
          return {
            result: {
              ok: true,
            },
          };
        }

        return {
          error: {
            code: -32601,
            message: `Unsupported method '${request.method}'.`,
          },
        };
      });

      let sandboxStartCount = 0;

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "idle-resume",
        });

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: seeded.runId,
          startSandboxProfileInstance: async () => {
            sandboxStartCount += 1;
            return {
              workflowRunId: `wfr_idle_${String(sandboxStartCount)}`,
              sandboxInstanceId: `sbi_idle_${String(sandboxStartCount)}`,
            };
          },
          getSandboxInstance: async ({ instanceId }) => ({
            id: instanceId,
            status: "running",
            failureCode: null,
            failureMessage: null,
          }),
          mintSandboxConnectionToken: async ({ instanceId }) => ({
            instanceId,
            url: rpcServer.url,
            token: "token_idle",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const followup = await seedFollowupAutomationRun({
          db: database.db,
          suffix: "idle-resume",
          automationId: seeded.automationId,
          automationTargetId: seeded.automationTargetId,
          organizationId: seeded.organizationId,
          sourceConnectionId: seeded.sourceConnectionId,
        });

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: followup.runId,
          startSandboxProfileInstance: async () => {
            sandboxStartCount += 1;
            return {
              workflowRunId: `wfr_idle_${String(sandboxStartCount)}`,
              sandboxInstanceId: `sbi_idle_${String(sandboxStartCount)}`,
            };
          },
          getSandboxInstance: async ({ instanceId }) => ({
            id: instanceId,
            status: "running",
            failureCode: null,
            failureMessage: null,
          }),
          mintSandboxConnectionToken: async ({ instanceId }) => ({
            instanceId,
            url: rpcServer.url,
            token: "token_idle",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        expect(sandboxStartCount).toBe(1);

        const methodNames = rpcServer.requests
          .map((request) => request.method)
          .filter((methodName) => methodName !== "initialize");
        expect(methodNames).toEqual([
          "thread/start",
          "turn/start",
          "thread/read",
          "thread/resume",
          "turn/start",
        ]);
      } finally {
        await rpcServer.close();
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "resumes the same sandbox instance when the previous route sandbox is stopped",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      let turnStartCount = 0;

      const rpcServer = await startCodexTestServer((request) => {
        if (request.method === "thread/start") {
          return {
            result: {
              thread: {
                id: "thread_stopped_001",
              },
            },
          };
        }

        if (request.method === "turn/start") {
          turnStartCount += 1;
          return {
            result: {
              turn: {
                id: `turn_stopped_00${String(turnStartCount)}`,
              },
            },
          };
        }

        if (request.method === "thread/read") {
          return {
            result: {
              thread: {
                id: "thread_stopped_001",
                status: {
                  type: "idle",
                },
              },
            },
          };
        }

        if (request.method === "thread/resume") {
          return {
            result: {
              ok: true,
            },
          };
        }

        return {
          error: {
            code: -32601,
            message: `Unsupported method '${request.method}'.`,
          },
        };
      });

      let sandboxStartCount = 0;

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "stopped-rebind",
        });

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: seeded.runId,
          startSandboxProfileInstance: async () => {
            sandboxStartCount += 1;
            return {
              workflowRunId: `wfr_stopped_${String(sandboxStartCount)}`,
              sandboxInstanceId: `sbi_stopped_${String(sandboxStartCount)}`,
            };
          },
          getSandboxInstance: async ({ instanceId }) => ({
            id: instanceId,
            status: "running",
            failureCode: null,
            failureMessage: null,
          }),
          mintSandboxConnectionToken: async ({ instanceId }) => ({
            instanceId,
            url: rpcServer.url,
            token: "token_stopped",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const followup = await seedFollowupAutomationRun({
          db: database.db,
          suffix: "stopped-rebind",
          automationId: seeded.automationId,
          automationTargetId: seeded.automationTargetId,
          organizationId: seeded.organizationId,
          sourceConnectionId: seeded.sourceConnectionId,
        });

        let stoppedRecoveryPollCount = 0;

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: followup.runId,
          startSandboxProfileInstance: async () => {
            sandboxStartCount += 1;
            return {
              workflowRunId: `wfr_stopped_${String(sandboxStartCount)}`,
              sandboxInstanceId: `sbi_stopped_${String(sandboxStartCount)}`,
            };
          },
          getSandboxInstance: async ({ instanceId }) => {
            if (instanceId === "sbi_stopped_1" && stoppedRecoveryPollCount === 0) {
              stoppedRecoveryPollCount += 1;
              return {
                id: instanceId,
                status: "stopped",
                failureCode: null,
                failureMessage: null,
              };
            }

            return {
              id: instanceId,
              status: "running",
              failureCode: null,
              failureMessage: null,
            };
          },
          mintSandboxConnectionToken: async ({ instanceId }) => ({
            instanceId,
            url: rpcServer.url,
            token: "token_stopped",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        expect(sandboxStartCount).toBe(1);

        const persistedConversation = await database.db.query.conversations.findFirst({
          where: (table, { eq }) => eq(table.organizationId, seeded.organizationId),
        });
        if (persistedConversation === undefined) {
          throw new Error("Expected conversation row.");
        }

        const persistedRoute = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.conversationId, persistedConversation.id),
        });
        expect(persistedRoute?.sandboxInstanceId).toBe("sbi_stopped_1");
        expect(persistedRoute?.providerExecutionId).toBe("turn_stopped_002");

        const methodNames = rpcServer.requests
          .map((request) => request.method)
          .filter((methodName) => methodName !== "initialize");
        expect(methodNames).toEqual([
          "thread/start",
          "turn/start",
          "thread/read",
          "thread/resume",
          "turn/start",
        ]);
      } finally {
        await rpcServer.close();
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "fails explicitly when provider reports active conversation but persisted execution id is missing",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      const rpcServer = await startCodexTestServer((request) => {
        if (request.method === "thread/read") {
          return {
            result: {
              thread: {
                id: "thread_missing_execution",
                status: {
                  type: "active",
                },
              },
            },
          };
        }

        return {
          error: {
            code: -32601,
            message: `Unsupported method '${request.method}'.`,
          },
        };
      });

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "missing-execution",
        });

        const claimedConversation = await claimAutomationConversation(
          {
            db: database.db,
          },
          {
            preparedAutomationRun: await prepareAutomationRun(
              {
                db: database.db,
              },
              {
                automationRunId: seeded.runId,
              },
            ),
          },
        );

        const insertedRoute = await database.db
          .insert(conversationRoutes)
          .values({
            conversationId: claimedConversation.conversationId,
            sandboxInstanceId: "sbi_missing_execution",
            providerConversationId: "thread_missing_execution",
            providerExecutionId: null,
            providerState: null,
            status: "active",
          })
          .returning();
        if (insertedRoute[0] === undefined) {
          throw new Error("Expected inserted conversation route.");
        }

        await expect(
          executeAutomationConversationRun({
            db: database.db,
            automationRunId: seeded.runId,
            startSandboxProfileInstance: async () => ({
              workflowRunId: "wfr_missing_execution",
              sandboxInstanceId: "sbi_missing_execution_new",
            }),
            getSandboxInstance: async ({ instanceId }) => ({
              id: instanceId,
              status: "running",
              failureCode: null,
              failureMessage: null,
            }),
            mintSandboxConnectionToken: async ({ instanceId }) => ({
              instanceId,
              url: rpcServer.url,
              token: "token_missing_execution",
              expiresAt: "2026-03-07T01:00:00.000Z",
            }),
          }),
        ).rejects.toMatchObject({
          code: "provider_execution_missing",
        });

        const persistedRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq }) => eq(table.id, seeded.runId),
        });
        expect(persistedRun?.status).toBe(AutomationRunStatuses.FAILED);
        expect(persistedRun?.failureCode).toBe("provider_execution_missing");
      } finally {
        await rpcServer.close();
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "replaces provider conversation binding when thread is missing and starts a new execution",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      const rpcServer = await startCodexTestServer((request) => {
        if (request.method === "thread/read") {
          return {
            error: {
              code: -32600,
              message: "invalid thread id: thread_old",
            },
          };
        }

        if (request.method === "thread/start") {
          return {
            result: {
              thread: {
                id: "thread_replaced",
              },
            },
          };
        }

        if (request.method === "turn/start") {
          return {
            result: {
              turn: {
                id: "turn_replaced",
              },
            },
          };
        }

        return {
          error: {
            code: -32601,
            message: `Unsupported method '${request.method}'.`,
          },
        };
      });

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "replace-binding",
        });

        const prepared = await prepareAutomationRun(
          {
            db: database.db,
          },
          {
            automationRunId: seeded.runId,
          },
        );
        const claimed = await claimAutomationConversation(
          {
            db: database.db,
          },
          {
            preparedAutomationRun: prepared,
          },
        );

        await database.db
          .update(conversationRoutes)
          .set({
            sandboxInstanceId: "sbi_replace_binding",
            providerConversationId: "thread_old",
            providerExecutionId: "turn_old",
            status: "active",
          })
          .where(eq(conversationRoutes.conversationId, claimed.conversationId));

        const existingRoute = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.conversationId, claimed.conversationId),
        });
        if (existingRoute === undefined) {
          await database.db.insert(conversationRoutes).values({
            conversationId: claimed.conversationId,
            sandboxInstanceId: "sbi_replace_binding",
            providerConversationId: "thread_old",
            providerExecutionId: "turn_old",
            providerState: null,
            status: "active",
          });
        }

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: seeded.runId,
          startSandboxProfileInstance: async () => ({
            workflowRunId: "wfr_replace_binding",
            sandboxInstanceId: "sbi_replace_binding",
          }),
          getSandboxInstance: async ({ instanceId }) => ({
            id: instanceId,
            status: "running",
            failureCode: null,
            failureMessage: null,
          }),
          mintSandboxConnectionToken: async ({ instanceId }) => ({
            instanceId,
            url: rpcServer.url,
            token: "token_replace_binding",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const persistedConversation = await database.db.query.conversations.findFirst({
          where: (table, { eq }) => eq(table.organizationId, seeded.organizationId),
        });
        if (persistedConversation === undefined) {
          throw new Error("Expected conversation row.");
        }

        const persistedRoute = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.conversationId, persistedConversation.id),
        });
        expect(persistedRoute?.providerConversationId).toBe("thread_replaced");
        expect(persistedRoute?.providerExecutionId).toBe("turn_replaced");
      } finally {
        await rpcServer.close();
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
