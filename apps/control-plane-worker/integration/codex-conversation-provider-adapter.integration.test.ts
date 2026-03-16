import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reserveAvailablePort } from "@mistle/test-harness";
import { systemScheduler, systemSleeper, type TimerHandle } from "@mistle/time";
import { describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import { createCodexConversationProviderAdapter } from "../openworkflow/handle-automation-conversation-delivery/codex-conversation-provider-adapter.js";
import type { ProviderConnection } from "../openworkflow/handle-automation-conversation-delivery/provider-adapter.js";
import {
  ConversationProviderError,
  ConversationProviderErrorCodes,
} from "../openworkflow/handle-automation-conversation-delivery/provider-errors.js";

const OPENAI_API_KEY_ENV = "MISTLE_TEST_OPENAI_API_KEY";
const PREFERRED_INTEGRATION_MODELS = ["gpt-5-codex-mini", "gpt-5.1-codex-mini"] as const;
const EXECUTION_PROMPT = "Without using tools or shell commands, reply with exactly: ok";
const EXPECTED_ASSISTANT_REPLY = "ok";
const SERVER_START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;
const PROCESS_STOP_TIMEOUT_MS = 10_000;
const TURN_HISTORY_TIMEOUT_MS = 90_000;
const TURN_SETTLE_TIMEOUT_MS = 120_000;

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

type StartedCodexAppServer = {
  wsUrl: string;
  getLogsTail: () => string;
  close: () => Promise<void>;
};

type StartCodexAppServerInput = {
  codexHome?: string;
  cleanupCodexHomeOnClose?: boolean;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: TimerHandle;
};

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

async function resolveIntegrationModel(connection: ProviderConnection): Promise<string> {
  const modelListResult = await connection.request({
    method: "model/list",
    params: {},
  });
  if (!isCodexTestPayloadObject(modelListResult) || !Array.isArray(modelListResult.data)) {
    throw new Error("Codex model/list response did not include a data array.");
  }

  const availableModels: string[] = [];
  for (const modelEntry of modelListResult.data) {
    if (!isCodexTestPayloadObject(modelEntry) || typeof modelEntry.model !== "string") {
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

type CodexTestPayloadObject = {
  [key: string]: unknown;
};

function isCodexTestPayloadObject(value: unknown): value is CodexTestPayloadObject {
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
  if (!isCodexTestPayloadObject(parsedPayload)) {
    return null;
  }

  if (typeof parsedPayload.id !== "string") {
    return null;
  }

  if ("error" in parsedPayload) {
    if (!isCodexTestPayloadObject(parsedPayload.error)) {
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
        error: new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
          message: `Codex app-server request '${pendingRequest.method}' failed (${String(responsePayload.error.code)}): ${responsePayload.error.message}`,
          cause: {
            method: pendingRequest.method,
            errorCode: responsePayload.error.code,
            errorMessage: responsePayload.error.message,
            errorData: responsePayload.error.data,
          },
        }),
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
        title: "Mistle Control Plane Worker Integration",
        version: "0.1.0",
      },
    },
  });
  if (
    !isCodexTestPayloadObject(initializeResult) ||
    typeof initializeResult.userAgent !== "string"
  ) {
    await connection.close();
    throw new Error("Codex initialize response did not include userAgent.");
  }

  await sendJsonRpcNotification({
    socket,
    method: "initialized",
  });

  return connection;
}

function isTransientThreadReadError(error: ConversationProviderError): boolean {
  if (error.code !== ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED) {
    return false;
  }
  const normalizedMessage = error.message.toLowerCase();
  return (
    normalizedMessage.includes("no rollout found for thread id") ||
    (normalizedMessage.includes("rollout at") && normalizedMessage.includes("is empty")) ||
    normalizedMessage.includes("includeturns is unavailable before first user message")
  );
}

function hasPersistedUserMessageText(input: {
  threadReadResult: unknown;
  expectedText: string;
}): boolean {
  const { threadReadResult, expectedText } = input;
  if (!isCodexTestPayloadObject(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }
  const thread = threadReadResult.thread;
  if (!isCodexTestPayloadObject(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (!isCodexTestPayloadObject(turn) || !Array.isArray(turn.items)) {
      continue;
    }
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!isCodexTestPayloadObject(item)) {
        continue;
      }
      if (item.type !== "userMessage") {
        continue;
      }
      if (!Array.isArray(item.content)) {
        throw new Error("thread/read userMessage item must include content array.");
      }
      for (const contentItem of item.content) {
        if (!isCodexTestPayloadObject(contentItem)) {
          continue;
        }
        if (contentItem.type !== "text" || typeof contentItem.text !== "string") {
          continue;
        }
        if (contentItem.text === expectedText) {
          return true;
        }
      }
    }
  }

  return false;
}

function hasPersistedAgentMessageText(input: {
  threadReadResult: unknown;
  expectedText: string;
}): boolean {
  const { threadReadResult } = input;
  if (!isCodexTestPayloadObject(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }
  const thread = threadReadResult.thread;
  if (!isCodexTestPayloadObject(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (!isCodexTestPayloadObject(turn) || !Array.isArray(turn.items)) {
      continue;
    }
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!isCodexTestPayloadObject(item)) {
        continue;
      }
      if (item.type !== "agentMessage" || typeof item.text !== "string") {
        continue;
      }
      const normalizedItemText = item.text.trim().replaceAll("`", "").trim().toLowerCase();
      if (normalizedItemText === input.expectedText.toLowerCase()) {
        return true;
      }
    }
  }

  return false;
}

function readLatestAgentMessageText(threadReadResult: unknown): string | null {
  if (!isCodexTestPayloadObject(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }
  const thread = threadReadResult.thread;
  if (!isCodexTestPayloadObject(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (!isCodexTestPayloadObject(turn) || !Array.isArray(turn.items)) {
      continue;
    }
    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex];
      if (!isCodexTestPayloadObject(item)) {
        continue;
      }
      if (item.type === "agentMessage" && typeof item.text === "string") {
        return item.text;
      }
    }
  }

  return null;
}

function readLatestTurnErrorMessage(threadReadResult: unknown): string | null {
  if (!isCodexTestPayloadObject(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }
  const thread = threadReadResult.thread;
  if (!isCodexTestPayloadObject(thread) || !Array.isArray(thread.turns)) {
    throw new Error("thread/read result.thread.turns must be an array.");
  }

  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (!isCodexTestPayloadObject(turn) || !isCodexTestPayloadObject(turn.error)) {
      continue;
    }
    if (typeof turn.error.message === "string") {
      return turn.error.message;
    }
  }

  return null;
}

async function waitForPromptToPersistInTurnHistory(input: {
  connection: ProviderConnection;
  providerConversationId: string;
  expectedPrompt: string;
}): Promise<void> {
  const deadlineAt = Date.now() + TURN_HISTORY_TIMEOUT_MS;

  while (Date.now() < deadlineAt) {
    try {
      const threadReadResult = await input.connection.request({
        method: "thread/read",
        params: {
          threadId: input.providerConversationId,
          includeTurns: true,
        },
      });
      if (
        hasPersistedUserMessageText({
          threadReadResult,
          expectedText: input.expectedPrompt,
        })
      ) {
        return;
      }
    } catch (error) {
      if (!(error instanceof ConversationProviderError)) {
        throw error;
      }
      if (!isTransientThreadReadError(error)) {
        throw error;
      }
    }

    await systemSleeper.sleep(500);
  }

  throw new Error("Timed out waiting for Codex thread/read to include the execution prompt.");
}

function readThreadStatusType(threadReadResult: unknown): string {
  if (!isCodexTestPayloadObject(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }
  const thread = threadReadResult.thread;
  if (
    !isCodexTestPayloadObject(thread) ||
    !isCodexTestPayloadObject(thread.status) ||
    typeof thread.status.type !== "string"
  ) {
    throw new Error("thread/read result.thread.status.type must be a string.");
  }

  return thread.status.type;
}

function readThreadRolloutPath(threadReadResult: unknown): string | null {
  if (!isCodexTestPayloadObject(threadReadResult)) {
    throw new Error("thread/read result must be an object.");
  }
  const thread = threadReadResult.thread;
  if (!isCodexTestPayloadObject(thread)) {
    throw new Error("thread/read result.thread must be an object.");
  }
  if (typeof thread.path !== "string" || thread.path.length === 0) {
    return null;
  }

  return thread.path;
}

async function readRolloutTail(path: string): Promise<string> {
  try {
    const content = await readFile(path, "utf8");
    const lines = content.split("\n").filter((line) => line.length > 0);
    const tail = lines.slice(-80);
    return tail.length === 0 ? "<empty>" : tail.join("\n");
  } catch (error) {
    return `failed to read rollout tail at ${path}: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

async function waitForRolloutFileToHaveContent(input: {
  connection: ProviderConnection;
  providerConversationId: string;
}): Promise<void> {
  const deadlineAt = Date.now() + TURN_HISTORY_TIMEOUT_MS;

  while (Date.now() < deadlineAt) {
    try {
      const threadReadResult = await input.connection.request({
        method: "thread/read",
        params: {
          threadId: input.providerConversationId,
          includeTurns: true,
        },
      });
      const rolloutPath = readThreadRolloutPath(threadReadResult);
      if (rolloutPath !== null) {
        const rolloutContent = await readFile(rolloutPath, "utf8");
        if (rolloutContent.trim().length > 0) {
          return;
        }
      }
    } catch (error) {
      if (!(error instanceof ConversationProviderError)) {
        throw error;
      }
      if (!isTransientThreadReadError(error)) {
        throw error;
      }
    }

    await systemSleeper.sleep(500);
  }

  throw new Error("Timed out waiting for Codex rollout file to have content.");
}

async function waitForThreadToBecomeIdle(input: {
  connection: ProviderConnection;
  providerConversationId: string;
  getAppServerLogsTail?: () => string;
}): Promise<void> {
  const deadlineAt = Date.now() + TURN_SETTLE_TIMEOUT_MS;

  while (Date.now() < deadlineAt) {
    const threadReadResult = await input.connection.request({
      method: "thread/read",
      params: {
        threadId: input.providerConversationId,
      },
    });
    const statusType = readThreadStatusType(threadReadResult);
    if (statusType === "idle") {
      return;
    }
    if (statusType === "systemError") {
      const threadReadWithTurns = await input.connection.request({
        method: "thread/read",
        params: {
          threadId: input.providerConversationId,
          includeTurns: true,
        },
      });
      const turnErrorMessage = readLatestTurnErrorMessage(threadReadWithTurns);
      const threadPayload = JSON.stringify(threadReadWithTurns);
      const rolloutPath = readThreadRolloutPath(threadReadWithTurns);
      const rolloutTail =
        rolloutPath === null ? "<thread.path unavailable>" : await readRolloutTail(rolloutPath);
      const logsTail =
        input.getAppServerLogsTail === undefined
          ? ""
          : `\nApp-server logs:\n${input.getAppServerLogsTail()}`;
      if (turnErrorMessage !== null) {
        throw new Error(
          `Codex thread entered systemError while waiting for turn completion: ${turnErrorMessage}\nthread/read payload: ${threadPayload}\nrollout tail:\n${rolloutTail}${logsTail}`,
        );
      }

      throw new Error(
        `Codex thread entered systemError while waiting for turn completion.\nthread/read payload: ${threadPayload}\nrollout tail:\n${rolloutTail}${logsTail}`,
      );
    }

    await systemSleeper.sleep(500);
  }

  throw new Error("Timed out waiting for Codex thread to become idle.");
}

async function waitForAssistantReplyToPersistInTurnHistory(input: {
  connection: ProviderConnection;
  providerConversationId: string;
  expectedReply: string;
}): Promise<void> {
  const deadlineAt = Date.now() + TURN_HISTORY_TIMEOUT_MS;
  let lastObservedAgentMessage: string | null = null;

  while (Date.now() < deadlineAt) {
    try {
      const threadReadResult = await input.connection.request({
        method: "thread/read",
        params: {
          threadId: input.providerConversationId,
          includeTurns: true,
        },
      });
      if (
        hasPersistedAgentMessageText({
          threadReadResult,
          expectedText: input.expectedReply,
        })
      ) {
        return;
      }

      lastObservedAgentMessage = readLatestAgentMessageText(threadReadResult);
    } catch (error) {
      if (!(error instanceof ConversationProviderError)) {
        throw error;
      }
      if (!isTransientThreadReadError(error)) {
        throw error;
      }
    }

    await systemSleeper.sleep(500);
  }

  if (lastObservedAgentMessage !== null) {
    throw new Error(
      `Timed out waiting for expected assistant reply '${input.expectedReply}'. Latest assistant reply was '${lastObservedAgentMessage.trim()}'.`,
    );
  }

  throw new Error("Timed out waiting for Codex thread/read to include any assistant reply.");
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

async function startCodexAppServer(
  input: StartCodexAppServerInput = {},
): Promise<StartedCodexAppServer> {
  const openAiApiKey = process.env[OPENAI_API_KEY_ENV];
  if (openAiApiKey === undefined || openAiApiKey.length === 0) {
    throw new Error("MISTLE_TEST_OPENAI_API_KEY is required.");
  }

  const host = "127.0.0.1";
  const port = await reserveAvailablePort({ host });
  const wsUrl = `ws://${host}:${String(port)}`;
  const codexHome = input.codexHome ?? (await mkdtemp(join(tmpdir(), "mistle-codex-it-")));
  const cleanupCodexHomeOnClose = input.cleanupCodexHomeOnClose ?? input.codexHome === undefined;

  try {
    await writeFile(
      join(codexHome, "config.toml"),
      `approval_policy = "never"\nsandbox_mode = "danger-full-access"\n`,
      "utf8",
    );
    await writeFile(
      join(codexHome, "AGENTS.md"),
      "# Codex integration test instructions\n\n- Respond to user prompts directly.\n- Do not assume repository context.\n",
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

    const codexProcess = spawn("codex", ["app-server", "--listen", wsUrl], {
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
        await stopCodexProcess(codexProcess);
        if (cleanupCodexHomeOnClose) {
          await rm(codexHome, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (cleanupCodexHomeOnClose) {
      await rm(codexHome, { recursive: true, force: true });
    }
    throw error;
  }
}

const describeCodexIntegration = shouldRunCodexIntegration() ? describe : describe.skip;

describeCodexIntegration("codex conversation provider adapter integration", () => {
  it("does not map thread-not-loaded errors to exists=false after app-server restart", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "mistle-codex-it-restart-"));
    const adapter = createCodexConversationProviderAdapter();
    let createdConversationId = "";

    try {
      const firstServer = await startCodexAppServer({
        codexHome,
        cleanupCodexHomeOnClose: false,
      });
      const firstConnection = await connectInitializedCodexConnection(firstServer.wsUrl);

      try {
        const integrationModel = await resolveIntegrationModel(firstConnection);
        const createdAutomationConversation = await adapter.createAutomationConversation({
          connection: firstConnection,
          options: {
            model: integrationModel,
          },
        });
        createdConversationId = createdAutomationConversation.providerConversationId;

        const startedExecution = await adapter.startExecution({
          connection: firstConnection,
          providerConversationId: createdConversationId,
          inputText: EXECUTION_PROMPT,
        });
        expect(startedExecution.providerExecutionId).not.toBeNull();

        await waitForRolloutFileToHaveContent({
          connection: firstConnection,
          providerConversationId: createdConversationId,
        });
      } finally {
        await firstConnection.close();
        await firstServer.close();
      }

      expect(createdConversationId.length).toBeGreaterThan(0);

      const secondServer = await startCodexAppServer({
        codexHome,
        cleanupCodexHomeOnClose: false,
      });
      const secondConnection = await connectInitializedCodexConnection(secondServer.wsUrl);

      try {
        const restartedInspection = await adapter.inspectAutomationConversation({
          connection: secondConnection,
          providerConversationId: createdConversationId,
        });
        expect(restartedInspection.exists).toBe(true);
        expect(["idle", "active", "error"]).toContain(restartedInspection.status);
      } finally {
        await secondConnection.close();
        await secondServer.close();
      }
    } finally {
      await rm(codexHome, { recursive: true, force: true });
    }
  }, 180_000);

  it("maps missing codex automationConversations to exists=false", async () => {
    const codexServer = await startCodexAppServer();
    const connection = await connectInitializedCodexConnection(codexServer.wsUrl);
    const adapter = createCodexConversationProviderAdapter();

    try {
      const missingInspection = await adapter.inspectAutomationConversation({
        connection,
        providerConversationId: randomUUID(),
      });
      expect(missingInspection).toEqual({
        exists: false,
        status: "idle",
        activeExecutionId: null,
      });
    } finally {
      await connection.close();
      await codexServer.close();
    }
  }, 180_000);

  it("maps missing thread errors for start/steer and preserves resume no-rollout as resume_failed", async () => {
    const codexServer = await startCodexAppServer();
    const connection = await connectInitializedCodexConnection(codexServer.wsUrl);
    const adapter = createCodexConversationProviderAdapter();
    const missingConversationId = randomUUID();

    try {
      await expect(
        adapter.resumeAutomationConversation({
          connection,
          providerConversationId: missingConversationId,
        }),
      ).rejects.toMatchObject({
        code: ConversationProviderErrorCodes.PROVIDER_RESUME_FAILED,
      });

      await expect(
        adapter.startExecution({
          connection,
          providerConversationId: missingConversationId,
          inputText: EXECUTION_PROMPT,
        }),
      ).rejects.toMatchObject({
        code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
      });

      if (adapter.steerExecution === undefined) {
        throw new Error("Codex adapter must implement steerExecution for this integration test.");
      }
      await expect(
        adapter.steerExecution({
          connection,
          providerConversationId: missingConversationId,
          providerExecutionId: randomUUID(),
          inputText: "continue",
        }),
      ).rejects.toMatchObject({
        code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
      });
    } finally {
      await connection.close();
      await codexServer.close();
    }
  }, 180_000);

  it("maps turn/steer no-active-turn errors to provider_execution_missing", async () => {
    const codexServer = await startCodexAppServer();
    const connection = await connectInitializedCodexConnection(codexServer.wsUrl);
    const adapter = createCodexConversationProviderAdapter();

    try {
      const integrationModel = await resolveIntegrationModel(connection);

      const createdAutomationConversation = await adapter.createAutomationConversation({
        connection,
        options: {
          model: integrationModel,
        },
      });

      if (adapter.steerExecution === undefined) {
        throw new Error("Codex adapter must implement steerExecution for this integration test.");
      }
      await expect(
        adapter.steerExecution({
          connection,
          providerConversationId: createdAutomationConversation.providerConversationId,
          providerExecutionId: randomUUID(),
          inputText: "continue",
        }),
      ).rejects.toMatchObject({
        code: ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING,
      });
    } finally {
      await connection.close();
      await codexServer.close();
    }
  }, 180_000);

  it("uses a real codex app-server for create/start/resume/inspect lifecycle", async () => {
    const codexServer = await startCodexAppServer();
    const connection = await connectInitializedCodexConnection(codexServer.wsUrl);
    const resumeConnection = await connectInitializedCodexConnection(codexServer.wsUrl);
    const adapter = createCodexConversationProviderAdapter();

    try {
      const integrationModel = await resolveIntegrationModel(connection);

      const createdAutomationConversation = await adapter.createAutomationConversation({
        connection,
        options: {
          model: integrationModel,
        },
      });
      expect(createdAutomationConversation.providerConversationId.length).toBeGreaterThan(0);

      const inspectedAutomationConversation = await adapter.inspectAutomationConversation({
        connection,
        providerConversationId: createdAutomationConversation.providerConversationId,
      });
      expect(inspectedAutomationConversation.exists).toBe(true);
      expect(["idle", "active"]).toContain(inspectedAutomationConversation.status);
      expect(inspectedAutomationConversation.activeExecutionId).toBeNull();

      const startedExecution = await adapter.startExecution({
        connection,
        providerConversationId: createdAutomationConversation.providerConversationId,
        inputText: EXECUTION_PROMPT,
      });
      expect(startedExecution.providerExecutionId).not.toBeNull();
      if (startedExecution.providerExecutionId === null) {
        throw new Error("Expected providerExecutionId from turn/start.");
      }
      expect(startedExecution.providerExecutionId.length).toBeGreaterThan(0);

      await waitForThreadToBecomeIdle({
        connection,
        providerConversationId: createdAutomationConversation.providerConversationId,
        getAppServerLogsTail: codexServer.getLogsTail,
      });

      await waitForPromptToPersistInTurnHistory({
        connection,
        providerConversationId: createdAutomationConversation.providerConversationId,
        expectedPrompt: EXECUTION_PROMPT,
      });

      await waitForAssistantReplyToPersistInTurnHistory({
        connection,
        providerConversationId: createdAutomationConversation.providerConversationId,
        expectedReply: EXPECTED_ASSISTANT_REPLY,
      });

      await adapter.resumeAutomationConversation({
        connection: resumeConnection,
        providerConversationId: createdAutomationConversation.providerConversationId,
      });

      const resumedInspection = await adapter.inspectAutomationConversation({
        connection: resumeConnection,
        providerConversationId: createdAutomationConversation.providerConversationId,
      });
      expect(resumedInspection.exists).toBe(true);
      expect(["idle", "active"]).toContain(resumedInspection.status);
    } finally {
      await connection.close();
      await resumeConnection.close();
      await codexServer.close();
    }
  }, 180_000);
});
