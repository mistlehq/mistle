import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { reserveAvailablePort } from "@mistle/test-harness";
import { systemScheduler, systemSleeper, type TimerHandle } from "@mistle/time";
import type { HandleAutomationRunWorkflowInput } from "@mistle/workflows/control-plane";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";
import WebSocket, { type RawData, WebSocketServer } from "ws";

import type { ProviderConnection } from "../src/runtime/conversations/provider-adapter.js";
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

const OPENAI_API_KEY_ENV = "OPENAI_API_KEY";
const PREFERRED_INTEGRATION_MODELS = ["gpt-5-codex-mini", "gpt-5.1-codex-mini"] as const;
const TestTimeoutMs = 180_000;
const SERVER_START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;
const PROCESS_STOP_TIMEOUT_MS = 10_000;

type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcResponsePayload = {
  id: string;
  result?: unknown;
  error?: JsonRpcErrorPayload;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: TimerHandle;
};

type StartedCodexAppServer = {
  wsUrl: string;
  getLogsTail: () => string;
  close: () => Promise<void>;
};

type StartedCodexAgentBridge = {
  wsUrl: string;
  close: () => Promise<void>;
};

function hasOpenAiApiKey(): boolean {
  const value = process.env[OPENAI_API_KEY_ENV];
  return typeof value === "string" && value.length > 0;
}

function isCodexCliAvailable(): boolean {
  const commandResult = spawnSync("codex", ["--version"], { stdio: "ignore" });
  return commandResult.error === undefined && commandResult.status === 0;
}

function shouldRunCodexIntegration(): boolean {
  return isCodexCliAvailable() && hasOpenAiApiKey();
}

function ensureCodexApiLogin(input: { codexHome: string; openAiApiKey: string }): void {
  const loginResult = spawnSync("codex", ["login", "--with-api-key"], {
    cwd: input.codexHome,
    env: {
      ...process.env,
      CODEX_HOME: input.codexHome,
    },
    input: input.openAiApiKey,
    encoding: "utf8",
  });

  if (loginResult.error !== undefined) {
    throw loginResult.error;
  }
  if (loginResult.status !== 0) {
    const stderr = loginResult.stderr.trim();
    throw new Error(
      `Failed to authenticate Codex CLI for integration test: ${stderr.length > 0 ? stderr : "unknown error"}`,
    );
  }
}

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

function parseJsonRpcResponsePayload(data: RawData): JsonRpcResponsePayload | null {
  const payloadText = toText(data);

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    return null;
  }
  if (!isRecord(parsedPayload)) {
    return null;
  }

  if (typeof parsedPayload.id !== "string") {
    return null;
  }

  if ("error" in parsedPayload) {
    if (!isRecord(parsedPayload.error)) {
      return null;
    }
    if (
      typeof parsedPayload.error.code !== "number" ||
      typeof parsedPayload.error.message !== "string"
    ) {
      return null;
    }

    return {
      id: parsedPayload.id,
      error: {
        code: parsedPayload.error.code,
        message: parsedPayload.error.message,
        data: "data" in parsedPayload.error ? parsedPayload.error.data : undefined,
      },
    };
  }

  if (!("result" in parsedPayload)) {
    return null;
  }

  return {
    id: parsedPayload.id,
    result: parsedPayload.result,
  };
}

function createJsonRpcConnection(socket: WebSocket): ProviderConnection {
  const pendingRequests = new Map<string, PendingRequest>();

  function settlePendingRequest(input: {
    requestId: string;
    value?: unknown;
    error?: Error;
  }): void {
    const pendingRequest = pendingRequests.get(input.requestId);
    if (pendingRequest === undefined) {
      return;
    }

    pendingRequests.delete(input.requestId);
    systemScheduler.cancel(pendingRequest.timeout);
    if (input.error !== undefined) {
      pendingRequest.reject(input.error);
      return;
    }

    pendingRequest.resolve(input.value);
  }

  function rejectPendingRequests(error: Error): void {
    for (const [requestId, pendingRequest] of pendingRequests.entries()) {
      pendingRequests.delete(requestId);
      systemScheduler.cancel(pendingRequest.timeout);
      pendingRequest.reject(error);
    }
  }

  socket.on("message", (data) => {
    const responsePayload = parseJsonRpcResponsePayload(data);
    if (responsePayload === null) {
      return;
    }

    const requestId = responsePayload.id;
    const pendingRequest = pendingRequests.get(requestId);
    if (pendingRequest === undefined) {
      return;
    }

    if (responsePayload.error !== undefined) {
      settlePendingRequest({
        requestId,
        error: new Error(
          `Codex app-server request '${pendingRequest.method}' failed (${String(responsePayload.error.code)}): ${responsePayload.error.message}`,
        ),
      });
      return;
    }

    if (responsePayload.result === undefined) {
      settlePendingRequest({
        requestId,
        error: new Error("Codex JSON-RPC response did not include result."),
      });
      return;
    }

    settlePendingRequest({
      requestId,
      value: responsePayload.result,
    });
  });

  socket.on("error", (error) => {
    rejectPendingRequests(error);
  });

  socket.on("close", () => {
    rejectPendingRequests(new Error("Codex websocket connection closed."));
  });

  return {
    request: async (input) => {
      const requestId = randomUUID();
      const requestPayload =
        input.params === undefined
          ? { id: requestId, method: input.method }
          : { id: requestId, method: input.method, params: input.params };

      return await new Promise<unknown>((resolve, reject) => {
        const timeout = systemScheduler.schedule(() => {
          pendingRequests.delete(requestId);
          reject(new Error(`Timed out waiting for Codex response to '${input.method}'.`));
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, {
          method: input.method,
          resolve: (value) => resolve(value),
          reject: (error) => reject(error),
          timeout,
        });

        socket.send(JSON.stringify(requestPayload), (error) => {
          if (error == null) {
            return;
          }

          settlePendingRequest({
            requestId,
            error,
          });
        });
      });
    },
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        const onClose = (): void => {
          socket.off("error", onError);
          resolve();
        };
        const onError = (): void => {
          socket.off("close", onClose);
          resolve();
        };
        socket.once("close", onClose);
        socket.once("error", onError);
        socket.close(1000, "integration test finished");
      });
    },
  };
}

async function openWebSocketConnection(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url, {
    handshakeTimeout: REQUEST_TIMEOUT_MS,
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", (error) => reject(error));
  });

  return socket;
}

async function sendJsonRpcNotification(input: {
  socket: WebSocket;
  method: string;
  params?: unknown;
}): Promise<void> {
  const payload =
    input.params === undefined
      ? { method: input.method }
      : { method: input.method, params: input.params };

  await new Promise<void>((resolve, reject) => {
    input.socket.send(JSON.stringify(payload), (error) => {
      if (error == null) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function connectInitializedCodexConnection(wsUrl: string): Promise<ProviderConnection> {
  const socket = await openWebSocketConnection(wsUrl);
  const connection = createJsonRpcConnection(socket);

  const initializeResult = await connection.request({
    method: "initialize",
    params: {
      clientInfo: {
        name: "mistle_control_plane_worker_it",
        title: "Mistle Control Plane Worker Routing Integration",
        version: "0.1.0",
      },
    },
  });
  if (!isRecord(initializeResult) || typeof initializeResult.userAgent !== "string") {
    await connection.close();
    throw new Error("Codex initialize response did not include userAgent.");
  }

  await sendJsonRpcNotification({
    socket,
    method: "initialized",
  });

  return connection;
}

async function resolveIntegrationModel(connection: ProviderConnection): Promise<string> {
  const modelListResult = await connection.request({
    method: "model/list",
    params: {},
  });
  if (!isRecord(modelListResult) || !Array.isArray(modelListResult.data)) {
    throw new Error("Codex model/list response did not include a data array.");
  }

  const availableModels: string[] = [];
  for (const modelEntry of modelListResult.data) {
    if (!isRecord(modelEntry) || typeof modelEntry.model !== "string") {
      continue;
    }
    availableModels.push(modelEntry.model);
  }

  for (const preferredModel of PREFERRED_INTEGRATION_MODELS) {
    if (availableModels.includes(preferredModel)) {
      return preferredModel;
    }
  }

  const renderedAvailableModels =
    availableModels.length === 0 ? "none" : availableModels.join(", ");
  throw new Error(
    `Codex integration requires one of [${PREFERRED_INTEGRATION_MODELS.join(", ")}], but available models were: ${renderedAvailableModels}.`,
  );
}

async function waitForProcessExit(process: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (process.exitCode !== null) {
    return true;
  }

  const timeout = systemSleeper.sleep(timeoutMs).then(() => false);
  const exited = once(process, "exit").then(() => true);
  return await Promise.race([timeout, exited]);
}

async function stopCodexProcess(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }

  process.kill("SIGTERM");
  if (await waitForProcessExit(process, PROCESS_STOP_TIMEOUT_MS)) {
    return;
  }

  process.kill("SIGKILL");
  await waitForProcessExit(process, PROCESS_STOP_TIMEOUT_MS);
}

async function probeWebSocketServer(url: string): Promise<void> {
  const socket = await openWebSocketConnection(url);
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.once("error", () => resolve());
    socket.close(1000, "probe");
  });
}

async function waitForCodexServerReady(input: {
  process: ChildProcess;
  wsUrl: string;
}): Promise<void> {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  let lastErrorMessage = "unavailable";

  while (Date.now() < deadline) {
    if (input.process.exitCode !== null) {
      throw new Error(`Codex app-server exited early with code ${String(input.process.exitCode)}.`);
    }

    try {
      await probeWebSocketServer(input.wsUrl);
      return;
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : "unknown startup error";
    }

    await systemSleeper.sleep(250);
  }

  throw new Error(
    `Timed out waiting for Codex app-server websocket at ${input.wsUrl}. Last error: ${lastErrorMessage}`,
  );
}

async function startCodexAppServer(): Promise<StartedCodexAppServer> {
  const openAiApiKey = process.env[OPENAI_API_KEY_ENV];
  if (openAiApiKey === undefined || openAiApiKey.length === 0) {
    throw new Error("OPENAI_API_KEY is required.");
  }

  const host = "127.0.0.1";
  const port = await reserveAvailablePort({ host });
  const wsUrl = `ws://${host}:${String(port)}`;
  const codexHome = await mkdtemp(join(tmpdir(), "mistle-codex-routing-it-"));
  let codexProcess: ChildProcess | null = null;

  try {
    await writeFile(
      join(codexHome, "config.toml"),
      `approval_policy = "never"\nsandbox_mode = "danger-full-access"\n`,
      "utf8",
    );
    await writeFile(
      join(codexHome, "AGENTS.md"),
      "# Codex integration test instructions\\n\\n- Respond to user prompts directly.\\n- Do not assume repository context.\\n",
      "utf8",
    );
    ensureCodexApiLogin({
      codexHome,
      openAiApiKey,
    });

    const codexProcessEnv: NodeJS.ProcessEnv = {
      ...process.env,
      OPENAI_API_KEY: openAiApiKey,
      CODEX_HOME: codexHome,
    };
    for (const key of Object.keys(codexProcessEnv)) {
      if (key.startsWith("CODEX_") && key !== "CODEX_HOME") {
        delete codexProcessEnv[key];
      }
    }

    codexProcess = spawn("codex", ["app-server", "--listen", wsUrl], {
      cwd: codexHome,
      env: codexProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutTail: string[] = [];
    const stderrTail: string[] = [];
    const maxTailLines = 80;
    const appendLogChunk = (target: string[], chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        if (line.length === 0) {
          continue;
        }
        target.push(line);
        if (target.length > maxTailLines) {
          target.shift();
        }
      }
    };

    codexProcess.stdout?.on("data", (chunk: Buffer) => {
      appendLogChunk(stdoutTail, chunk);
    });
    codexProcess.stderr?.on("data", (chunk: Buffer) => {
      appendLogChunk(stderrTail, chunk);
    });

    await waitForCodexServerReady({
      process: codexProcess,
      wsUrl,
    });

    return {
      wsUrl,
      getLogsTail: () => {
        const renderedStdout = stdoutTail.join("\n");
        const renderedStderr = stderrTail.join("\n");
        return `stdout:\n${renderedStdout || "<empty>"}\n\nstderr:\n${renderedStderr || "<empty>"}`;
      },
      close: async () => {
        if (codexProcess !== null) {
          await stopCodexProcess(codexProcess);
        }
        await rm(codexHome, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (codexProcess !== null) {
      await stopCodexProcess(codexProcess);
    }
    await rm(codexHome, { recursive: true, force: true });
    throw error;
  }
}

async function startCodexAgentBridge(input: {
  targetWsUrl: string;
}): Promise<StartedCodexAgentBridge> {
  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error) => reject(error));
  });

  wsServer.on("connection", (clientSocket) => {
    let connectRequestId: string | null = null;
    let upstreamSocket: WebSocket | null = null;

    const closeUpstream = (): void => {
      if (upstreamSocket === null) {
        return;
      }
      if (
        upstreamSocket.readyState === WebSocket.OPEN ||
        upstreamSocket.readyState === WebSocket.CONNECTING
      ) {
        upstreamSocket.close(1000, "bridge closed");
      }
      upstreamSocket = null;
    };

    const closeClient = (message: string): void => {
      if (
        clientSocket.readyState === WebSocket.OPEN ||
        clientSocket.readyState === WebSocket.CONNECTING
      ) {
        clientSocket.close(1011, message);
      }
    };

    clientSocket.on("message", (rawData) => {
      const payloadText = toText(rawData);
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(payloadText);
      } catch {
        closeClient("invalid JSON payload");
        closeUpstream();
        return;
      }
      if (!isRecord(parsedPayload)) {
        closeClient("invalid JSON payload");
        closeUpstream();
        return;
      }

      if (connectRequestId === null) {
        if (
          parsedPayload.type !== "connect" ||
          typeof parsedPayload.requestId !== "string" ||
          !isRecord(parsedPayload.channel) ||
          parsedPayload.channel.kind !== "agent"
        ) {
          closeClient("missing connect handshake");
          closeUpstream();
          return;
        }

        connectRequestId = parsedPayload.requestId;
        upstreamSocket = new WebSocket(input.targetWsUrl, {
          handshakeTimeout: REQUEST_TIMEOUT_MS,
        });

        upstreamSocket.once("open", () => {
          if (clientSocket.readyState !== WebSocket.OPEN || connectRequestId === null) {
            return;
          }
          clientSocket.send(
            JSON.stringify({
              type: "connect.ok",
              requestId: connectRequestId,
            }),
          );
        });
        upstreamSocket.once("error", (error) => {
          if (clientSocket.readyState === WebSocket.OPEN && connectRequestId !== null) {
            clientSocket.send(
              JSON.stringify({
                type: "connect.error",
                requestId: connectRequestId,
                code: "upstream_connect_failed",
                message: error.message,
              }),
            );
          }
          closeClient("upstream connect failed");
          closeUpstream();
        });
        upstreamSocket.on("message", (upstreamData) => {
          if (clientSocket.readyState !== WebSocket.OPEN) {
            return;
          }
          clientSocket.send(toText(upstreamData));
        });
        upstreamSocket.on("close", () => {
          closeClient("upstream closed");
        });
        return;
      }

      if (upstreamSocket === null || upstreamSocket.readyState !== WebSocket.OPEN) {
        closeClient("upstream unavailable");
        closeUpstream();
        return;
      }

      upstreamSocket.send(payloadText);
    });

    clientSocket.on("close", () => {
      closeUpstream();
    });
    clientSocket.on("error", () => {
      closeUpstream();
    });
  });

  const address = wsServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected websocket server to expose a numeric port.");
  }

  return {
    wsUrl: `ws://127.0.0.1:${String(address.port)}`,
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

type RoutingTestEnvironment = {
  database: Awaited<ReturnType<typeof createTestDatabase>>;
  codexServer: StartedCodexAppServer;
  codexBridge: StartedCodexAgentBridge;
  integrationModel: string;
  close: () => Promise<void>;
};

async function startRoutingTestEnvironment(input: {
  databaseUrl: string;
}): Promise<RoutingTestEnvironment> {
  let database: Awaited<ReturnType<typeof createTestDatabase>> | null = null;
  let codexServer: StartedCodexAppServer | null = null;
  let codexBridge: StartedCodexAgentBridge | null = null;
  let modelConnection: ProviderConnection | null = null;

  try {
    database = await createTestDatabase({
      databaseUrl: input.databaseUrl,
    });
    codexServer = await startCodexAppServer();
    codexBridge = await startCodexAgentBridge({
      targetWsUrl: codexServer.wsUrl,
    });

    modelConnection = await connectInitializedCodexConnection(codexServer.wsUrl);
    const integrationModel = await resolveIntegrationModel(modelConnection);
    await modelConnection.close();
    modelConnection = null;
    if (database === null || codexServer === null || codexBridge === null) {
      throw new Error("Routing test environment setup produced an unexpected null resource.");
    }
    const readyDatabase = database;
    const readyCodexServer = codexServer;
    const readyCodexBridge = codexBridge;

    return {
      database: readyDatabase,
      codexServer: readyCodexServer,
      codexBridge: readyCodexBridge,
      integrationModel,
      close: async () => {
        if (modelConnection !== null) {
          await modelConnection.close();
        }
        await readyCodexBridge.close();
        await readyCodexServer.close();
        await readyDatabase.stop();
      },
    };
  } catch (error) {
    if (modelConnection !== null) {
      await modelConnection.close();
    }
    if (codexBridge !== null) {
      await codexBridge.close();
    }
    if (codexServer !== null) {
      await codexServer.close();
    }
    if (database !== null) {
      await database.stop();
    }
    throw error;
  }
}

async function seedAutomationScenario(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  suffix: string;
  model: string;
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
      defaultModel: input.model,
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

const describeCodexIntegration = shouldRunCodexIntegration() ? describe : describe.skip;

describeCodexIntegration("handleAutomationRun conversation routing integration", () => {
  it(
    "creates provider conversation on first run and reuses it on follow-up run",
    async ({ fixture }) => {
      const testEnvironment = await startRoutingTestEnvironment({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });
      const { database, codexBridge, integrationModel } = testEnvironment;

      let sandboxStartCount = 0;

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "first-second",
          model: integrationModel,
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
            url: codexBridge.wsUrl,
            token: "token_route",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const routeAfterFirstRun = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.sandboxInstanceId, "sbi_route_1"),
        });
        expect(routeAfterFirstRun).toBeDefined();
        if (routeAfterFirstRun === undefined) {
          throw new Error("Expected conversation route after first run.");
        }
        expect(routeAfterFirstRun.providerConversationId).not.toBeNull();
        expect(routeAfterFirstRun.providerExecutionId).not.toBeNull();

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
            url: codexBridge.wsUrl,
            token: "token_route",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        expect(sandboxStartCount).toBe(1);

        const routeAfterSecondRun = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, routeAfterFirstRun.id),
        });
        expect(routeAfterSecondRun).toBeDefined();
        if (routeAfterSecondRun === undefined) {
          throw new Error("Expected conversation route after second run.");
        }
        expect(routeAfterSecondRun.providerConversationId).toBe(
          routeAfterFirstRun.providerConversationId,
        );
        expect(routeAfterSecondRun.providerExecutionId).not.toBeNull();
      } finally {
        await testEnvironment.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "reuses the same sandbox instance when an existing route reports stopped then recovers",
    async ({ fixture }) => {
      const testEnvironment = await startRoutingTestEnvironment({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });
      const { database, codexBridge, integrationModel } = testEnvironment;

      let sandboxStartCount = 0;

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "stopped-recover",
          model: integrationModel,
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
            url: codexBridge.wsUrl,
            token: "token_stopped",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const routeAfterFirstRun = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.sandboxInstanceId, "sbi_stopped_1"),
        });
        if (routeAfterFirstRun === undefined) {
          throw new Error("Expected initial conversation route.");
        }

        const followup = await seedFollowupAutomationRun({
          db: database.db,
          suffix: "stopped-recover",
          automationId: seeded.automationId,
          automationTargetId: seeded.automationTargetId,
          organizationId: seeded.organizationId,
          sourceConnectionId: seeded.sourceConnectionId,
        });

        let stoppedPollCount = 0;
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
            if (instanceId === "sbi_stopped_1" && stoppedPollCount === 0) {
              stoppedPollCount += 1;
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
            url: codexBridge.wsUrl,
            token: "token_stopped",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        expect(sandboxStartCount).toBe(1);

        const routeAfterSecondRun = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, routeAfterFirstRun.id),
        });
        expect(routeAfterSecondRun?.sandboxInstanceId).toBe("sbi_stopped_1");
        expect(routeAfterSecondRun?.providerConversationId).toBe(
          routeAfterFirstRun.providerConversationId,
        );
      } finally {
        await testEnvironment.close();
      }
    },
    TestTimeoutMs,
  );

  it(
    "replaces provider conversation binding when persisted thread id is missing",
    async ({ fixture }) => {
      const testEnvironment = await startRoutingTestEnvironment({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });
      const { database, codexBridge, integrationModel } = testEnvironment;

      try {
        const seeded = await seedAutomationScenario({
          db: database.db,
          suffix: "replace-binding",
          model: integrationModel,
        });

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: seeded.runId,
          startSandboxProfileInstance: async () => ({
            workflowRunId: "wfr_replace_binding_1",
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
            url: codexBridge.wsUrl,
            token: "token_replace_binding",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const persistedConversation = await database.db.query.conversations.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.organizationId, seeded.organizationId),
        });
        if (persistedConversation === undefined) {
          throw new Error("Expected conversation row after first run.");
        }

        const existingRoute = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq: whereEq }) =>
            whereEq(table.conversationId, persistedConversation.id),
        });
        if (existingRoute === undefined) {
          throw new Error("Expected route row after first run.");
        }

        const missingThreadId = randomUUID();
        await database.db
          .update(conversationRoutes)
          .set({
            providerConversationId: missingThreadId,
            providerExecutionId: randomUUID(),
          })
          .where(eq(conversationRoutes.id, existingRoute.id));

        const followup = await seedFollowupAutomationRun({
          db: database.db,
          suffix: "replace-binding",
          automationId: seeded.automationId,
          automationTargetId: seeded.automationTargetId,
          organizationId: seeded.organizationId,
          sourceConnectionId: seeded.sourceConnectionId,
        });

        await executeAutomationConversationRun({
          db: database.db,
          automationRunId: followup.runId,
          startSandboxProfileInstance: async () => ({
            workflowRunId: "wfr_replace_binding_2",
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
            url: codexBridge.wsUrl,
            token: "token_replace_binding",
            expiresAt: "2026-03-07T01:00:00.000Z",
          }),
        });

        const routeAfterReplacement = await database.db.query.conversationRoutes.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, existingRoute.id),
        });
        expect(routeAfterReplacement).toBeDefined();
        if (routeAfterReplacement === undefined) {
          throw new Error("Expected route row after replacement run.");
        }

        expect(routeAfterReplacement.providerConversationId).not.toBeNull();
        expect(routeAfterReplacement.providerConversationId).not.toBe(missingThreadId);
        expect(routeAfterReplacement.providerExecutionId).not.toBeNull();
      } finally {
        await testEnvironment.close();
      }
    },
    TestTimeoutMs,
  );
});
