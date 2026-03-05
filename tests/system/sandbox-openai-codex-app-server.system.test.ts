/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from dashboard system test context.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { describe, expect } from "vitest";
import { z } from "zod";

import { it } from "./system-test-context.js";

const OPENAI_TARGET_KEY = "openai-default";
const OPENAI_API_KEY_ENV_NAME = "MISTLE_SYSTEM_OPENAI_API_KEY";
const DATA_PLANE_GATEWAY_BASE_URL_ENV_NAME = "MISTLE_SYSTEM_DATA_PLANE_GATEWAY_BASE_URL";
const TEST_RESPONSE_MARKER = "SYSTEM_TEST_OK";
const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const CREATE_CONNECTION_TIMEOUT_MS = 30_000;
const CREATE_PROFILE_TIMEOUT_MS = 30_000;
const PUT_BINDINGS_TIMEOUT_MS = 30_000;
const START_INSTANCE_TIMEOUT_MS = 3 * 60_000;
const MINT_CONNECTION_TOKEN_TIMEOUT_MS = 30_000;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 30_000;
const WEBSOCKET_MESSAGE_TIMEOUT_MS = 30_000;
const TURN_COMPLETION_TIMEOUT_MS = 90_000;
const WEBSOCKET_TRACE_EVENT_LIMIT = 300;
const WEBSOCKET_TRACE_TAIL_COUNT = 40;
const DOCKER_DIAGNOSTIC_TIMEOUT_MS = 10_000;
const DOCKER_DIAGNOSTIC_MAX_BUFFER_BYTES = 1_000_000;
const DIAGNOSTIC_OUTPUT_MAX_CHARS = 24_000;

const execFileAsync = promisify(execFile);

const ConnectOKSchema = z
  .object({
    type: z.literal("connect.ok"),
    requestId: z.string().min(1),
  })
  .strict();

const ConnectErrorSchema = z
  .object({
    type: z.literal("connect.error"),
    requestId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

const JsonRpcIdSchema = z.union([z.string().min(1), z.number().int()]);

const JsonRpcSuccessResponseSchema = z.looseObject({
  id: JsonRpcIdSchema,
  result: z.unknown(),
});

const JsonRpcErrorResponseSchema = z.looseObject({
  id: JsonRpcIdSchema,
  error: z.looseObject({
    code: z.number().int(),
    message: z.string().min(1),
    data: z.unknown().optional(),
  }),
});

const JsonRpcNotificationSchema = z.looseObject({
  method: z.string().min(1),
  params: z.unknown().optional(),
});

const JsonRpcRequestSchema = z.looseObject({
  method: z.string().min(1),
  id: JsonRpcIdSchema,
  params: z.unknown().optional(),
});

const ThreadStartResultSchema = z.looseObject({
  thread: z.looseObject({
    id: z.string().min(1),
  }),
});

const TurnStartResultSchema = z.looseObject({
  turn: z.looseObject({
    id: z.string().min(1),
  }),
});

type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;

type TurnCompletion = {
  turnId: string;
  status: string;
  errorMessage: string | null;
};

type JsonRpcNotification = {
  method: string;
  params: unknown;
};

type StepTraceEntry = {
  name: string;
  startedAtEpochMs: number;
  completedAtEpochMs: number | null;
};

type WebSocketTraceEntry = {
  atEpochMs: number;
  summary: string;
  raw?: string;
};

type QueuedWebSocketJsonMessage =
  | {
      kind: "message";
      payload: unknown;
    }
  | {
      kind: "error";
      error: Error;
    };

type PendingWebSocketJsonMessageWaiter = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutSignal: AbortSignal;
  onTimeout: () => void;
};

type WebSocketJsonMessagePump = {
  queue: QueuedWebSocketJsonMessage[];
  waiters: PendingWebSocketJsonMessageWaiter[];
};

const WebSocketJsonMessagePumps = new WeakMap<WebSocket, WebSocketJsonMessagePump>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required system test environment variable: ${name}`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected field '${key}' to be a non-empty string.`);
  }

  return value;
}

function readOptionalStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value;
}

async function expectStatusJson(input: {
  response: Response;
  status: number;
  description: string;
}): Promise<unknown> {
  if (input.response.status !== input.status) {
    const responseBody = await input.response.text().catch(() => "");
    throw new Error(
      `${input.description} expected status ${String(input.status)}, got ${String(input.response.status)}. Response body: ${responseBody}`,
    );
  }

  try {
    return await input.response.json();
  } catch (error) {
    throw new Error(
      `${input.description} expected a JSON response body, but parsing failed with: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function toWebSocketProtocol(protocol: string): "ws:" | "wss:" {
  if (protocol === "http:" || protocol === "ws:") {
    return "ws:";
  }
  if (protocol === "https:" || protocol === "wss:") {
    return "wss:";
  }

  throw new Error(`Unsupported gateway base URL protocol '${protocol}'.`);
}

function resolveGatewayWebSocketUrl(input: { mintedUrl: string; gatewayBaseUrl: string }): string {
  const mintedUrl = new URL(input.mintedUrl);
  const gatewayBaseUrl = new URL(input.gatewayBaseUrl);

  mintedUrl.protocol = toWebSocketProtocol(gatewayBaseUrl.protocol);
  mintedUrl.hostname = gatewayBaseUrl.hostname;
  mintedUrl.port = gatewayBaseUrl.port;

  return mintedUrl.toString();
}

async function connectWebSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const onTimeout = (): void => {
      cleanup();
      socket.close();
      reject(new Error(`Timed out after ${String(timeoutMs)}ms while connecting websocket.`));
    };

    const onOpen = (): void => {
      cleanup();
      resolve(socket);
    };

    const onError = (): void => {
      cleanup();
      reject(new Error("Websocket connection failed before open."));
    };

    const onClose = (event: unknown): void => {
      cleanup();
      reject(
        new Error(`Websocket connection closed before open. ${describeWebSocketCloseEvent(event)}`),
      );
    };

    const cleanup = (): void => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      timeoutSignal.removeEventListener("abort", onTimeout);
    };

    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("error", onError, { once: true });
    socket.addEventListener("close", onClose, { once: true });
    timeoutSignal.addEventListener("abort", onTimeout, { once: true });
  });
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutSignal = AbortSignal.timeout(3_000);
    const onTimeout = (): void => {
      cleanup();
      resolve();
    };

    const onClose = (): void => {
      cleanup();
      resolve();
    };

    const cleanup = (): void => {
      socket.removeEventListener("close", onClose);
      timeoutSignal.removeEventListener("abort", onTimeout);
    };

    socket.addEventListener("close", onClose, { once: true });
    timeoutSignal.addEventListener("abort", onTimeout, { once: true });
    socket.close();
  });
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error(`Websocket is not open. Current readyState: ${String(socket.readyState)}.`);
  }

  socket.send(JSON.stringify(payload));
}

async function websocketDataToUtf8(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (data instanceof Blob) {
    const raw = await data.arrayBuffer();
    return Buffer.from(raw).toString("utf8");
  }

  throw new Error(`Unsupported websocket message data type: ${String(typeof data)}.`);
}

async function waitForNextWebSocketJsonMessage(
  socket: WebSocket,
  timeoutMs: number,
): Promise<unknown> {
  const pump = getWebSocketJsonMessagePump(socket);
  const prebuffered = dequeueWebSocketJsonMessage(pump);
  if (prebuffered !== undefined) {
    if (prebuffered.kind === "error") {
      throw prebuffered.error;
    }
    return prebuffered.payload;
  }

  if (timeoutMs <= 0) {
    throw new Error(`Timed out after ${String(timeoutMs)}ms waiting for websocket message.`);
  }

  return await new Promise((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const waiter: PendingWebSocketJsonMessageWaiter = {
      resolve,
      reject,
      timeoutSignal,
      onTimeout: () => {
        removeWebSocketJsonMessageWaiter(pump, waiter);
        reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for websocket message.`));
      },
    };

    pump.waiters.push(waiter);
    timeoutSignal.addEventListener("abort", waiter.onTimeout, { once: true });
    drainWebSocketJsonMessagePump(pump);
  });
}

function getWebSocketJsonMessagePump(socket: WebSocket): WebSocketJsonMessagePump {
  const existingPump = WebSocketJsonMessagePumps.get(socket);
  if (existingPump !== undefined) {
    return existingPump;
  }

  const pump: WebSocketJsonMessagePump = {
    queue: [],
    waiters: [],
  };

  const enqueue = (message: QueuedWebSocketJsonMessage): void => {
    pump.queue.push(message);
    drainWebSocketJsonMessagePump(pump);
  };

  const onMessage = (event: unknown): void => {
    void (async () => {
      try {
        if (!isRecord(event)) {
          throw new Error("Websocket message event payload was not an object.");
        }
        const text = await websocketDataToUtf8(event.data);
        const parsed: unknown = JSON.parse(text);
        enqueue({
          kind: "message",
          payload: parsed,
        });
      } catch (error) {
        enqueue({
          kind: "error",
          error: new Error(
            `Failed to parse websocket message as JSON: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        });
      }
    })();
  };

  const onError = (): void => {
    enqueue({
      kind: "error",
      error: new Error("Websocket emitted error while waiting for message."),
    });
  };

  const onClose = (event: unknown): void => {
    enqueue({
      kind: "error",
      error: new Error(
        `Websocket closed while waiting for message. ${describeWebSocketCloseEvent(event)}`,
      ),
    });
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);

  WebSocketJsonMessagePumps.set(socket, pump);
  return pump;
}

function dequeueWebSocketJsonMessage(
  pump: WebSocketJsonMessagePump,
): QueuedWebSocketJsonMessage | undefined {
  const nextMessage = pump.queue.shift();
  return nextMessage;
}

function removeWebSocketJsonMessageWaiter(
  pump: WebSocketJsonMessagePump,
  waiter: PendingWebSocketJsonMessageWaiter,
): void {
  const waiterIndex = pump.waiters.indexOf(waiter);
  if (waiterIndex < 0) {
    return;
  }

  pump.waiters.splice(waiterIndex, 1);
  waiter.timeoutSignal.removeEventListener("abort", waiter.onTimeout);
}

function drainWebSocketJsonMessagePump(pump: WebSocketJsonMessagePump): void {
  while (pump.waiters.length > 0 && pump.queue.length > 0) {
    const waiter = pump.waiters.shift();
    const queuedMessage = pump.queue.shift();
    if (waiter === undefined || queuedMessage === undefined) {
      return;
    }

    waiter.timeoutSignal.removeEventListener("abort", waiter.onTimeout);
    if (queuedMessage.kind === "error") {
      waiter.reject(queuedMessage.error);
      continue;
    }

    waiter.resolve(queuedMessage.payload);
  }
}

function formatJsonForError(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeWebSocketCloseEvent(event: unknown): string {
  if (!isRecord(event)) {
    return "unknown close event";
  }

  const code = event.code;
  const reason = event.reason;
  if (typeof code === "number" && typeof reason === "string") {
    return `code=${String(code)} reason=${reason}`;
  }
  if (typeof code === "number") {
    return `code=${String(code)}`;
  }

  return "unknown close event";
}

function remainingTimeMs(deadlineEpochMs: number): number {
  const remaining = deadlineEpochMs - Date.now();
  return remaining > 0 ? remaining : 0;
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const cause = readRecordField(error, "cause");
    if (cause !== undefined) {
      return `${error.name}: ${error.message}. cause=${describeUnknownError(cause)}`;
    }

    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function formatStepTrace(entries: StepTraceEntry[]): string {
  return entries
    .map((entry) => {
      const endedAtEpochMs = entry.completedAtEpochMs ?? Date.now();
      const durationMs = Math.max(0, endedAtEpochMs - entry.startedAtEpochMs);
      const state = entry.completedAtEpochMs === null ? "in_progress" : "completed";

      return `${entry.name}(${state},${String(durationMs)}ms)`;
    })
    .join(" -> ");
}

function truncateForDiagnostics(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }

  const omittedCount = input.length - maxChars;
  return `${input.slice(0, maxChars)}\n...<truncated ${String(omittedCount)} chars>`;
}

function normalizeCommandOutput(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim();
  }

  return "";
}

function readErrorField(error: unknown, field: "stdout" | "stderr"): unknown {
  return readRecordField(error, field);
}

function readRecordField(input: unknown, key: string): unknown {
  if (!isRecord(input)) {
    return undefined;
  }

  return input[key];
}

async function runDiagnosticCommand(input: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<string> {
  try {
    const result = await execFileAsync(input.command, input.args, {
      timeout: input.timeoutMs,
      maxBuffer: DOCKER_DIAGNOSTIC_MAX_BUFFER_BYTES,
      encoding: "utf8",
    });
    const stdout = normalizeCommandOutput(result.stdout);
    const stderr = normalizeCommandOutput(result.stderr);
    const combined = [stdout, stderr].filter((part) => part.length > 0).join("\n");
    return combined.length > 0 ? combined : "(no output)";
  } catch (error) {
    const stderr = normalizeCommandOutput(readErrorField(error, "stderr"));
    const stdout = normalizeCommandOutput(readErrorField(error, "stdout"));
    const detail =
      stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : describeUnknownError(error);

    return `command failed: ${input.command} ${input.args.join(" ")}\n${detail}`;
  }
}

function describeJsonRpcMessage(message: unknown): string {
  if (!isRecord(message)) {
    return "non-object";
  }

  const messageType = message.type;
  if (typeof messageType === "string" && messageType.length > 0) {
    return `tunnel/${messageType}`;
  }

  const method = message.method;
  if (typeof method === "string" && method.length > 0) {
    return `jsonrpc/notification ${method}`;
  }

  const id = message.id;
  if (typeof id === "string" || typeof id === "number") {
    if ("result" in message) {
      return `jsonrpc/response id=${String(id)}`;
    }
    if ("error" in message) {
      return `jsonrpc/error id=${String(id)}`;
    }
  }

  return "json-unknown";
}

function pushWebSocketTraceEntry(input: {
  sink: WebSocketTraceEntry[];
  summary: string;
  raw?: string;
}): void {
  input.sink.push({
    atEpochMs: Date.now(),
    summary: input.summary,
    ...(input.raw === undefined ? {} : { raw: input.raw }),
  });
  if (input.sink.length > WEBSOCKET_TRACE_EVENT_LIMIT) {
    input.sink.splice(0, input.sink.length - WEBSOCKET_TRACE_EVENT_LIMIT);
  }
}

function attachWebSocketTrace(input: {
  socket: WebSocket;
  sink: WebSocketTraceEntry[];
}): () => void {
  const onMessage = (event: unknown): void => {
    void (async () => {
      try {
        if (!isRecord(event)) {
          pushWebSocketTraceEntry({
            sink: input.sink,
            summary: "event/message malformed",
          });
          return;
        }

        const raw = await websocketDataToUtf8(event.data);
        try {
          const parsed: unknown = JSON.parse(raw);
          pushWebSocketTraceEntry({
            sink: input.sink,
            summary: describeJsonRpcMessage(parsed),
            raw,
          });
        } catch (parseError) {
          pushWebSocketTraceEntry({
            sink: input.sink,
            summary: `json/parse_error ${describeUnknownError(parseError)}`,
            raw,
          });
        }
      } catch (traceError) {
        pushWebSocketTraceEntry({
          sink: input.sink,
          summary: `event/message trace_error ${describeUnknownError(traceError)}`,
        });
      }
    })();
  };

  const onClose = (event: unknown): void => {
    pushWebSocketTraceEntry({
      sink: input.sink,
      summary: `event/close ${describeWebSocketCloseEvent(event)}`,
    });
  };

  const onError = (): void => {
    pushWebSocketTraceEntry({
      sink: input.sink,
      summary: "event/error",
    });
  };

  input.socket.addEventListener("message", onMessage);
  input.socket.addEventListener("close", onClose);
  input.socket.addEventListener("error", onError);

  return () => {
    input.socket.removeEventListener("message", onMessage);
    input.socket.removeEventListener("close", onClose);
    input.socket.removeEventListener("error", onError);
  };
}

function formatWebSocketTrace(entries: WebSocketTraceEntry[]): string {
  if (entries.length === 0) {
    return "(empty)";
  }

  const tail = entries.slice(-WEBSOCKET_TRACE_TAIL_COUNT);
  return tail
    .map((entry) => {
      const at = new Date(entry.atEpochMs).toISOString();
      const raw =
        entry.raw === undefined
          ? ""
          : `\n    raw=${truncateForDiagnostics(entry.raw, 400).replaceAll("\n", "\\n")}`;
      return `- ${at} ${entry.summary}${raw}`;
    })
    .join("\n");
}

async function collectSandboxContainerDiagnostics(providerSandboxId: string): Promise<string> {
  const inspectOutput = await runDiagnosticCommand({
    command: "docker",
    args: ["inspect", providerSandboxId],
    timeoutMs: DOCKER_DIAGNOSTIC_TIMEOUT_MS,
  });
  const logsOutput = await runDiagnosticCommand({
    command: "docker",
    args: ["logs", "--timestamps", "--tail", "300", providerSandboxId],
    timeoutMs: DOCKER_DIAGNOSTIC_TIMEOUT_MS,
  });

  return [
    `providerSandboxId=${providerSandboxId}`,
    "",
    "docker inspect:",
    truncateForDiagnostics(inspectOutput, DIAGNOSTIC_OUTPUT_MAX_CHARS),
    "",
    "docker logs:",
    truncateForDiagnostics(logsOutput, DIAGNOSTIC_OUTPUT_MAX_CHARS),
  ].join("\n");
}

async function collectSandboxContainerListDiagnostics(): Promise<string> {
  const output = await runDiagnosticCommand({
    command: "docker",
    args: [
      "ps",
      "-a",
      "--filter",
      "label=mistle.sandbox.provider=docker",
      "--format",
      "table {{.ID}}\\t{{.Status}}\\t{{.Image}}\\t{{.Names}}",
    ],
    timeoutMs: DOCKER_DIAGNOSTIC_TIMEOUT_MS,
  });

  return truncateForDiagnostics(output, DIAGNOSTIC_OUTPUT_MAX_CHARS);
}

async function runStep<T>(input: {
  stepTrace: StepTraceEntry[];
  stepName: string;
  action: () => Promise<T>;
}): Promise<T> {
  const step: StepTraceEntry = {
    name: input.stepName,
    startedAtEpochMs: Date.now(),
    completedAtEpochMs: null,
  };
  input.stepTrace.push(step);

  try {
    const result = await input.action();
    step.completedAtEpochMs = Date.now();
    return result;
  } catch (error) {
    throw new Error(
      `Step '${input.stepName}' failed. Step trace: ${formatStepTrace(input.stepTrace)}. Cause: ${describeUnknownError(error)}`,
    );
  }
}

async function requestWithTimeout(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  path: string;
  init?: RequestInit;
  timeoutMs: number;
  description: string;
}): Promise<Response> {
  try {
    return await input.request(input.path, {
      ...input.init,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
  } catch (error) {
    if (isAbortLikeError(error)) {
      throw new Error(
        `${input.description} timed out after ${String(input.timeoutMs)}ms while requesting '${input.path}'.`,
      );
    }

    throw new Error(
      `${input.description} request to '${input.path}' failed: ${describeUnknownError(error)}`,
    );
  }
}

async function waitForTunnelHandshakeAck(input: {
  socket: WebSocket;
  requestId: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;

  while (true) {
    const nextMessage = await waitForNextWebSocketJsonMessage(
      input.socket,
      remainingTimeMs(deadline),
    );

    const connectOK = ConnectOKSchema.safeParse(nextMessage);
    if (connectOK.success && connectOK.data.requestId === input.requestId) {
      return;
    }

    const connectError = ConnectErrorSchema.safeParse(nextMessage);
    if (connectError.success && connectError.data.requestId === input.requestId) {
      throw new Error(
        `Tunnel connect handshake failed with code '${connectError.data.code}': ${connectError.data.message}`,
      );
    }

    if (remainingTimeMs(deadline) === 0) {
      throw new Error("Timed out waiting for tunnel connect handshake acknowledgement.");
    }
  }
}

async function waitForJsonRpcResult(input: {
  socket: WebSocket;
  requestId: JsonRpcId;
  timeoutMs: number;
  notificationSink?: JsonRpcNotification[];
}): Promise<unknown> {
  const deadline = Date.now() + input.timeoutMs;

  while (true) {
    const nextMessage = await waitForNextWebSocketJsonMessage(
      input.socket,
      remainingTimeMs(deadline),
    );

    const success = JsonRpcSuccessResponseSchema.safeParse(nextMessage);
    if (success.success && success.data.id === input.requestId) {
      return success.data.result;
    }

    const failure = JsonRpcErrorResponseSchema.safeParse(nextMessage);
    if (failure.success && failure.data.id === input.requestId) {
      throw new Error(
        `JSON-RPC request id '${String(input.requestId)}' failed with code ${String(
          failure.data.error.code,
        )}: ${failure.data.error.message}`,
      );
    }

    const serverRequest = JsonRpcRequestSchema.safeParse(nextMessage);
    if (serverRequest.success) {
      throw new Error(
        `Unexpected server-initiated JSON-RPC request '${serverRequest.data.method}' (id '${String(serverRequest.data.id)}') received while waiting for response to id '${String(input.requestId)}'.`,
      );
    }

    const notification = JsonRpcNotificationSchema.safeParse(nextMessage);
    if (notification.success) {
      input.notificationSink?.push({
        method: notification.data.method,
        params: notification.data.params,
      });
      continue;
    }

    if (remainingTimeMs(deadline) === 0) {
      throw new Error(
        `Timed out waiting for JSON-RPC response with id '${String(input.requestId)}'.`,
      );
    }
  }
}

function collectAgentMessageText(input: { method: string; params: unknown; sink: string[] }): void {
  if (!isRecord(input.params)) {
    return;
  }

  if (input.method === "item/agentMessage/delta") {
    const delta = readOptionalStringField(input.params, "delta");
    if (delta !== null) {
      input.sink.push(delta);
    }
    return;
  }

  if (input.method !== "item/completed") {
    return;
  }

  const item = input.params.item;
  if (!isRecord(item)) {
    return;
  }

  const itemType = readOptionalStringField(item, "type");
  if (itemType !== "agentMessage") {
    return;
  }

  const text = readOptionalStringField(item, "text");
  if (text !== null) {
    input.sink.push(text);
  }

  const content = item.content;
  if (!Array.isArray(content)) {
    return;
  }

  for (const contentPart of content) {
    if (!isRecord(contentPart)) {
      continue;
    }
    const contentText = readOptionalStringField(contentPart, "text");
    if (contentText !== null) {
      input.sink.push(contentText);
    }
  }
}

function parseTurnCompletedNotification(message: unknown): TurnCompletion | null {
  const notification = JsonRpcNotificationSchema.safeParse(message);
  if (!notification.success || notification.data.method !== "turn/completed") {
    return null;
  }

  const params = notification.data.params;
  if (!isRecord(params)) {
    return null;
  }

  const turn = params.turn;
  if (!isRecord(turn)) {
    return null;
  }

  const turnId = readOptionalStringField(turn, "id");
  const status = readOptionalStringField(turn, "status");
  if (turnId === null || status === null) {
    return null;
  }

  const error = turn.error;
  const errorMessage = isRecord(error) ? readOptionalStringField(error, "message") : null;

  return {
    turnId,
    status,
    errorMessage,
  };
}

async function waitForTurnCompletion(input: {
  socket: WebSocket;
  turnId: string;
  timeoutMs: number;
  agentTextSink: string[];
}): Promise<TurnCompletion> {
  const deadline = Date.now() + input.timeoutMs;

  while (true) {
    const nextMessage = await waitForNextWebSocketJsonMessage(
      input.socket,
      remainingTimeMs(deadline),
    );

    const serverRequest = JsonRpcRequestSchema.safeParse(nextMessage);
    if (serverRequest.success) {
      throw new Error(
        `Unexpected server-initiated JSON-RPC request '${serverRequest.data.method}' with id '${String(serverRequest.data.id)}' while waiting for turn completion.`,
      );
    }

    const jsonRpcResponse =
      JsonRpcSuccessResponseSchema.safeParse(nextMessage).success ||
      JsonRpcErrorResponseSchema.safeParse(nextMessage).success;
    if (jsonRpcResponse) {
      throw new Error(
        `Unexpected JSON-RPC response received while waiting for turn completion: ${formatJsonForError(nextMessage)}`,
      );
    }

    const notification = JsonRpcNotificationSchema.safeParse(nextMessage);
    if (!notification.success) {
      throw new Error(
        `Unexpected websocket message while waiting for turn completion: ${formatJsonForError(nextMessage)}`,
      );
    }

    collectAgentMessageText({
      method: notification.data.method,
      params: notification.data.params,
      sink: input.agentTextSink,
    });

    const completion = parseTurnCompletedNotification(nextMessage);
    if (completion !== null && completion.turnId === input.turnId) {
      return completion;
    }

    if (remainingTimeMs(deadline) === 0) {
      throw new Error(`Timed out waiting for turn/completed for turn '${input.turnId}'.`);
    }
  }
}

describe("system sandbox openai codex app-server websocket tunnel", () => {
  it(
    "connects to an agent endpoint and exchanges Codex app-server JSON-RPC messages",
    async ({ fixture }) => {
      const stepTrace: StepTraceEntry[] = [];
      const openAiApiKey = requireEnv(OPENAI_API_KEY_ENV_NAME);
      const dataPlaneGatewayBaseUrl = requireEnv(DATA_PLANE_GATEWAY_BASE_URL_ENV_NAME);
      let websocketForCleanup: WebSocket | null = null;
      let detachWebSocketTrace: (() => void) | null = null;
      const websocketTraceEntries: WebSocketTraceEntry[] = [];
      let providerSandboxIdForDiagnostics: string | null = null;

      try {
        const authenticatedSession = await runStep({
          stepTrace,
          stepName: "create authenticated session",
          action: async () => {
            return await fixture.authSession();
          },
        });

        const createConnectionResponse = await runStep({
          stepTrace,
          stepName: "create OpenAI connection",
          action: async () => {
            return await requestWithTimeout({
              request: fixture.request,
              path: `/v1/integration/connections/${encodeURIComponent(OPENAI_TARGET_KEY)}/api-key`,
              timeoutMs: CREATE_CONNECTION_TIMEOUT_MS,
              description: "OpenAI API-key connection creation",
              init: {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  cookie: authenticatedSession.cookie,
                },
                body: JSON.stringify({
                  apiKey: openAiApiKey,
                }),
              },
            });
          },
        });
        const createConnectionPayload = await expectStatusJson({
          response: createConnectionResponse,
          status: 201,
          description: "OpenAI API-key connection creation",
        });
        if (!isRecord(createConnectionPayload)) {
          throw new Error("Expected OpenAI API-key connection response to be an object.");
        }
        const connectionId = readNonEmptyStringField(createConnectionPayload, "id");

        const profileDisplayName = `System OpenAI App-Server ${randomUUID()}`;
        const createProfileResponse = await runStep({
          stepTrace,
          stepName: "create sandbox profile",
          action: async () => {
            return await requestWithTimeout({
              request: fixture.request,
              path: "/v1/sandbox/profiles",
              timeoutMs: CREATE_PROFILE_TIMEOUT_MS,
              description: "sandbox profile creation",
              init: {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  cookie: authenticatedSession.cookie,
                },
                body: JSON.stringify({
                  displayName: profileDisplayName,
                }),
              },
            });
          },
        });
        const createProfilePayload = await expectStatusJson({
          response: createProfileResponse,
          status: 201,
          description: "sandbox profile creation",
        });
        if (!isRecord(createProfilePayload)) {
          throw new Error("Expected sandbox profile creation response to be an object.");
        }
        const profileId = readNonEmptyStringField(createProfilePayload, "id");

        const putBindingsResponse = await runStep({
          stepTrace,
          stepName: "bind OpenAI agent integration",
          action: async () => {
            return await requestWithTimeout({
              request: fixture.request,
              path: `/v1/sandbox/profiles/${encodeURIComponent(profileId)}/versions/1/integration-bindings`,
              timeoutMs: PUT_BINDINGS_TIMEOUT_MS,
              description: "sandbox profile integration binding update",
              init: {
                method: "PUT",
                headers: {
                  "content-type": "application/json",
                  cookie: authenticatedSession.cookie,
                },
                body: JSON.stringify({
                  bindings: [
                    {
                      connectionId,
                      kind: "agent",
                      config: {
                        runtime: "codex-cli",
                        defaultModel: "gpt-5.3-codex",
                        reasoningEffort: "medium",
                      },
                    },
                  ],
                }),
              },
            });
          },
        });
        await expectStatusJson({
          response: putBindingsResponse,
          status: 200,
          description: "sandbox profile integration binding update",
        });

        const startInstanceResponse = await runStep({
          stepTrace,
          stepName: "start sandbox instance",
          action: async () => {
            return await requestWithTimeout({
              request: fixture.request,
              path: `/v1/sandbox/profiles/${encodeURIComponent(profileId)}/versions/1/instances`,
              timeoutMs: START_INSTANCE_TIMEOUT_MS,
              description: "sandbox profile start instance",
              init: {
                method: "POST",
                headers: {
                  cookie: authenticatedSession.cookie,
                },
              },
            });
          },
        });
        const startInstancePayload = await expectStatusJson({
          response: startInstanceResponse,
          status: 201,
          description: "sandbox profile start instance",
        });
        if (!isRecord(startInstancePayload)) {
          throw new Error("Expected sandbox instance start response to be an object.");
        }
        const sandboxInstanceId = readNonEmptyStringField(
          startInstancePayload,
          "sandboxInstanceId",
        );
        providerSandboxIdForDiagnostics = readOptionalStringField(
          startInstancePayload,
          "providerSandboxId",
        );

        const mintConnectionTokenResponse = await runStep({
          stepTrace,
          stepName: "mint sandbox connection token",
          action: async () => {
            return await requestWithTimeout({
              request: fixture.request,
              path: `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}/connection-tokens`,
              timeoutMs: MINT_CONNECTION_TOKEN_TIMEOUT_MS,
              description: "sandbox connection token minting",
              init: {
                method: "POST",
                headers: {
                  cookie: authenticatedSession.cookie,
                },
              },
            });
          },
        });
        const mintConnectionTokenPayload = await expectStatusJson({
          response: mintConnectionTokenResponse,
          status: 201,
          description: "sandbox connection token minting",
        });
        if (!isRecord(mintConnectionTokenPayload)) {
          throw new Error("Expected sandbox connection token response to be an object.");
        }
        const mintedUrl = readNonEmptyStringField(mintConnectionTokenPayload, "url");
        const websocketUrl = resolveGatewayWebSocketUrl({
          mintedUrl,
          gatewayBaseUrl: dataPlaneGatewayBaseUrl,
        });

        const websocket = await runStep({
          stepTrace,
          stepName: "connect websocket tunnel",
          action: async () => {
            return await connectWebSocket(websocketUrl, WEBSOCKET_CONNECT_TIMEOUT_MS);
          },
        });
        websocketForCleanup = websocket;
        detachWebSocketTrace = attachWebSocketTrace({
          socket: websocket,
          sink: websocketTraceEntries,
        });

        const handshakeRequestId = `connect-${randomUUID()}`;
        await runStep({
          stepTrace,
          stepName: "tunnel connect handshake",
          action: async () => {
            sendJson(websocket, {
              type: "connect",
              v: 1,
              requestId: handshakeRequestId,
              channel: {
                kind: "agent",
              },
            });
            await waitForTunnelHandshakeAck({
              socket: websocket,
              requestId: handshakeRequestId,
              timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
            });
          },
        });

        await runStep({
          stepTrace,
          stepName: "json-rpc initialize",
          action: async () => {
            sendJson(websocket, {
              method: "initialize",
              id: 0,
              params: {
                clientInfo: {
                  name: "mistle_system_test",
                  title: "Mistle System Test",
                  version: "0.1.0",
                },
              },
            });
            await waitForJsonRpcResult({
              socket: websocket,
              requestId: 0,
              timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
            });
          },
        });

        await runStep({
          stepTrace,
          stepName: "json-rpc initialized notification",
          action: async () => {
            sendJson(websocket, {
              method: "initialized",
              params: {},
            });
          },
        });

        const threadId = await runStep({
          stepTrace,
          stepName: "json-rpc thread/start",
          action: async () => {
            sendJson(websocket, {
              method: "thread/start",
              id: 1,
              params: {
                model: "gpt-5.3-codex",
              },
            });
            const threadStartResult = await waitForJsonRpcResult({
              socket: websocket,
              requestId: 1,
              timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
            });
            const parsedThreadStartResult = ThreadStartResultSchema.safeParse(threadStartResult);
            if (!parsedThreadStartResult.success) {
              throw new Error(
                `thread/start result did not contain thread.id: ${formatJsonForError(threadStartResult)}`,
              );
            }

            return parsedThreadStartResult.data.thread.id;
          },
        });

        const notificationsWhileStartingTurn: JsonRpcNotification[] = [];
        const turnId = await runStep({
          stepTrace,
          stepName: "json-rpc turn/start",
          action: async () => {
            sendJson(websocket, {
              method: "turn/start",
              id: 2,
              params: {
                threadId,
                input: [
                  {
                    type: "text",
                    text: `Reply with exactly ${TEST_RESPONSE_MARKER} and nothing else.`,
                  },
                ],
              },
            });
            const turnStartResult = await waitForJsonRpcResult({
              socket: websocket,
              requestId: 2,
              timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
              notificationSink: notificationsWhileStartingTurn,
            });
            const parsedTurnStartResult = TurnStartResultSchema.safeParse(turnStartResult);
            if (!parsedTurnStartResult.success) {
              throw new Error(
                `turn/start result did not contain turn.id: ${formatJsonForError(turnStartResult)}`,
              );
            }

            return parsedTurnStartResult.data.turn.id;
          },
        });

        const agentTextParts: string[] = [];
        let preBufferedTurnCompletion: TurnCompletion | null = null;
        for (const notification of notificationsWhileStartingTurn) {
          collectAgentMessageText({
            method: notification.method,
            params: notification.params,
            sink: agentTextParts,
          });
          const completion = parseTurnCompletedNotification(notification);
          if (completion !== null && completion.turnId === turnId) {
            preBufferedTurnCompletion = completion;
          }
        }

        const turnCompletion = await runStep({
          stepTrace,
          stepName: "wait for turn/completed",
          action: async () => {
            return (
              preBufferedTurnCompletion ??
              (await waitForTurnCompletion({
                socket: websocket,
                turnId,
                timeoutMs: TURN_COMPLETION_TIMEOUT_MS,
                agentTextSink: agentTextParts,
              }))
            );
          },
        });
        expect(turnCompletion.status).toBe("completed");
        expect(turnCompletion.errorMessage).toBeNull();

        const combinedAgentText = agentTextParts.join("");
        expect(combinedAgentText.length).toBeGreaterThan(0);
        expect(combinedAgentText).toContain(TEST_RESPONSE_MARKER);
      } catch (error) {
        let diagnostics = `Websocket trace (tail):\n${formatWebSocketTrace(websocketTraceEntries)}`;
        if (providerSandboxIdForDiagnostics !== null) {
          const sandboxDiagnostics = await collectSandboxContainerDiagnostics(
            providerSandboxIdForDiagnostics,
          );
          diagnostics = `${diagnostics}\n\nSandbox container diagnostics:\n${sandboxDiagnostics}`;
        } else {
          const sandboxListDiagnostics = await collectSandboxContainerListDiagnostics();
          diagnostics = `${diagnostics}\n\nSandbox container diagnostics:\nproviderSandboxId unavailable\n\nKnown sandbox containers:\n${sandboxListDiagnostics}`;
        }

        throw new Error(
          `System test failed. Step trace: ${formatStepTrace(stepTrace)}. Cause: ${describeUnknownError(error)}\n\nDiagnostics:\n${diagnostics}`,
        );
      } finally {
        detachWebSocketTrace?.();
        if (websocketForCleanup !== null) {
          await closeWebSocket(websocketForCleanup);
        }
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
