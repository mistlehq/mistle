/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from dashboard system test context.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import {
  decodeDataFrame,
  encodeDataFrame,
  PayloadKindRawBytes,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import { it, type SystemTestFixture } from "./system-test-context.js";

const OPENAI_TARGET_KEY = "openai-default";
const GITHUB_TARGET_KEY = "github-cloud";
const OPENAI_API_KEY_ENV_NAME = "MISTLE_TEST_OPENAI_API_KEY";
const GITHUB_TEST_REPOSITORY_ENV_NAME = "MISTLE_TEST_GITHUB_TEST_REPOSITORY";
const GITHUB_INSTALLATION_ID_ENV_NAME = "MISTLE_TEST_GITHUB_INSTALLATION_ID";
const TEST_RESPONSE_MARKER = "SYSTEM_TEST_OK";
const GITHUB_TEST_RESPONSE_MARKER = "GH_FOUND";
const GITHUB_BINARY_PATH = "/var/lib/mistle/bin/gh";
const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const CREATE_CONNECTION_TIMEOUT_MS = 30_000;
const CREATE_PROFILE_TIMEOUT_MS = 30_000;
const PUT_BINDINGS_TIMEOUT_MS = 30_000;
const START_INSTANCE_TIMEOUT_MS = 3 * 60_000;
const MINT_CONNECTION_TOKEN_TIMEOUT_MS = 30_000;
const WEBSOCKET_CONNECT_TIMEOUT_MS = 30_000;
const WEBSOCKET_MESSAGE_TIMEOUT_MS = 30_000;
const TURN_COMPLETION_TIMEOUT_MS = 90_000;
const RESOURCE_SYNC_TIMEOUT_MS = 2 * 60_000;
const WEBSOCKET_TRACE_EVENT_LIMIT = 300;
const WEBSOCKET_TRACE_TAIL_COUNT = 40;
const DOCKER_DIAGNOSTIC_TIMEOUT_MS = 10_000;
const DOCKER_DIAGNOSTIC_MAX_BUFFER_BYTES = 1_000_000;
const DIAGNOSTIC_OUTPUT_MAX_CHARS = 24_000;
const TinyPngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8RcAAAAASUVORK5CYII=",
  "base64",
);

const execFileAsync = promisify(execFile);

const StreamOpenOKSchema = z
  .object({
    type: z.literal("stream.open.ok"),
    streamId: z.number().int().positive(),
  })
  .strict();

const StreamOpenErrorSchema = z
  .object({
    type: z.literal("stream.open.error"),
    streamId: z.number().int().positive(),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

const StreamResetSchema = z
  .object({
    type: z.literal("stream.reset"),
    streamId: z.number().int().positive(),
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

const FileUploadCompletedEventSchema = z
  .object({
    type: z.literal("stream.event"),
    streamId: z.number().int().positive(),
    event: z.looseObject({
      type: z.literal("fileUpload.completed"),
      attachmentId: z.string().min(1),
      path: z.string().min(1),
    }),
  })
  .strict();

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

const ThreadReadResultSchema = z.looseObject({
  thread: z.looseObject({
    id: z.string().min(1),
    turns: z
      .array(
        z.looseObject({
          id: z.string().min(1),
          items: z.array(z.unknown()).optional(),
        }),
      )
      .optional(),
  }),
});

const StartRedirectConnectionResponseSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

const RefreshIntegrationConnectionResourcesResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.literal("repository"),
    syncState: z.enum(["syncing", "ready", "error"]),
  })
  .strict();

const StartSandboxInstanceResponseSchema = z
  .object({
    status: z.literal("accepted"),
    workflowRunId: z.string().min(1),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

const SandboxInstanceStatusResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["starting", "running", "stopped", "failed"]),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    automationConversation: z
      .object({
        conversationId: z.string().min(1),
        routeId: z.string().min(1).nullable(),
        providerConversationId: z.string().min(1).nullable(),
      })
      .nullable(),
  })
  .strict();

type JsonRpcId = z.infer<typeof JsonRpcIdSchema>;

type TurnCompletion = {
  turnId: string;
  status: string;
  errorMessage: string | null;
};

type GitHubRepository = {
  owner: string;
  repo: string;
};

type CommandExecutionItem = {
  command: string;
  aggregatedOutput: string | null;
  exitCode: number | null;
  status: string | null;
};

type JsonRpcNotification = {
  method: string;
  params: unknown;
};

type UploadedSandboxImage = {
  attachmentId: string;
  path: string;
};

type AuthenticatedFixtureSession = Awaited<ReturnType<SystemTestFixture["authSession"]>>;

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

type AgentSocketSession = {
  websocket: WebSocket;
  detachWebSocketTrace: () => void;
  handshakeStreamId: number;
};

type SandboxScenarioContext = {
  stepTrace: StepTraceEntry[];
  websocketTraceEntries: WebSocketTraceEntry[];
  registerWebsocketCleanup: (cleanup: { socket: WebSocket; detachTrace: () => void }) => void;
};

const WebSocketJsonMessagePumps = new WeakMap<WebSocket, WebSocketJsonMessagePump>();

function hasRequiredGitHubEnv(): boolean {
  return [GITHUB_TEST_REPOSITORY_ENV_NAME, GITHUB_INSTALLATION_ID_ENV_NAME].every((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });
}

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

function readOptionalNumberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function parseGitHubRepository(input: string): GitHubRepository {
  const [owner, repo, ...rest] = input.split("/");
  if (
    owner === undefined ||
    owner.length === 0 ||
    repo === undefined ||
    repo.length === 0 ||
    rest.length > 0
  ) {
    throw new Error(
      `${GITHUB_TEST_REPOSITORY_ENV_NAME} must be 'owner/repo'. Received '${input}'.`,
    );
  }

  return {
    owner,
    repo,
  };
}

function createGitHubAppInstallationCompletePath(input: {
  targetKey: string;
  query: Record<string, string>;
}): string {
  const searchParams = new URLSearchParams(input.query);
  return `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/github-app-installation/complete?${searchParams.toString()}`;
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

function sendAgentJson(socket: WebSocket, streamId: number, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error(`Websocket is not open. Current readyState: ${String(socket.readyState)}.`);
  }

  const encodedPayload = encodeDataFrame({
    streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: Buffer.from(JSON.stringify(payload), "utf8"),
  });
  socket.send(encodedPayload);
}

function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  return null;
}

function parseTunnelJsonMessage(data: unknown): Promise<{
  parsed: unknown;
  raw: string;
}> {
  if (typeof data === "string") {
    return Promise.resolve({
      parsed: JSON.parse(data),
      raw: data,
    });
  }

  if (data instanceof Blob) {
    return data.arrayBuffer().then((rawPayload) => parseTunnelJsonMessage(rawPayload));
  }

  const binaryPayload = toUint8Array(data);
  if (binaryPayload === null) {
    return Promise.reject(
      new Error(`Unsupported websocket message data type: ${String(typeof data)}.`),
    );
  }

  const dataFrame = decodeDataFrame(binaryPayload);
  if (dataFrame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `Expected websocket text payload kind ${String(PayloadKindWebSocketText)}, received ${String(dataFrame.payloadKind)}.`,
    );
  }

  const raw = Buffer.from(dataFrame.payload).toString("utf8");
  return Promise.resolve({
    parsed: JSON.parse(raw),
    raw,
  });
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

  async function enqueueParsedMessage(data: unknown): Promise<void> {
    try {
      const parsedMessage = await parseTunnelJsonMessage(data);
      enqueue({
        kind: "message",
        payload: parsedMessage.parsed,
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
  }

  const onMessage = (event: unknown): void => {
    if (!isRecord(event)) {
      enqueue({
        kind: "error",
        error: new Error("Websocket message event payload was not an object."),
      });
      return;
    }

    void enqueueParsedMessage(event.data);
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
  async function traceMessage(data: unknown): Promise<void> {
    try {
      const parsedMessage = await parseTunnelJsonMessage(data);
      pushWebSocketTraceEntry({
        sink: input.sink,
        summary: describeJsonRpcMessage(parsedMessage.parsed),
        raw: parsedMessage.raw,
      });
    } catch (parseError) {
      try {
        const raw = await websocketDataToUtf8(data);
        pushWebSocketTraceEntry({
          sink: input.sink,
          summary: `json/parse_error ${describeUnknownError(parseError)}`,
          raw,
        });
      } catch (traceError) {
        pushWebSocketTraceEntry({
          sink: input.sink,
          summary: `event/message trace_error ${describeUnknownError(traceError)}`,
        });
      }
    }
  }

  const onMessage = (event: unknown): void => {
    if (!isRecord(event)) {
      pushWebSocketTraceEntry({
        sink: input.sink,
        summary: "event/message malformed",
      });
      return;
    }

    void traceMessage(event.data).catch((traceError: unknown) => {
      pushWebSocketTraceEntry({
        sink: input.sink,
        summary: `event/message trace_error ${describeUnknownError(traceError)}`,
      });
    });
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

async function collectDockerContainerLogsDiagnostics(input: {
  containerId: string;
  label: string;
}): Promise<string> {
  const output = await runDiagnosticCommand({
    command: "docker",
    args: ["logs", "--tail", "200", input.containerId],
    timeoutMs: DOCKER_DIAGNOSTIC_TIMEOUT_MS,
  });

  return `${input.label} (${input.containerId}):\n${truncateForDiagnostics(output, DIAGNOSTIC_OUTPUT_MAX_CHARS)}`;
}

async function collectAppContainerDiagnostics(input: {
  fixture: Pick<
    SystemTestFixture,
    | "controlPlaneApiContainerId"
    | "controlPlaneWorkerContainerId"
    | "dataPlaneApiContainerId"
    | "dataPlaneWorkerContainerId"
    | "dataPlaneGatewayContainerId"
    | "tokenizerProxyContainerId"
  >;
}): Promise<string> {
  const sections = await Promise.all([
    collectDockerContainerLogsDiagnostics({
      containerId: input.fixture.controlPlaneApiContainerId,
      label: "control-plane-api",
    }),
    collectDockerContainerLogsDiagnostics({
      containerId: input.fixture.controlPlaneWorkerContainerId,
      label: "control-plane-worker",
    }),
    collectDockerContainerLogsDiagnostics({
      containerId: input.fixture.dataPlaneApiContainerId,
      label: "data-plane-api",
    }),
    collectDockerContainerLogsDiagnostics({
      containerId: input.fixture.dataPlaneWorkerContainerId,
      label: "data-plane-worker",
    }),
    collectDockerContainerLogsDiagnostics({
      containerId: input.fixture.dataPlaneGatewayContainerId,
      label: "data-plane-gateway",
    }),
    collectDockerContainerLogsDiagnostics({
      containerId: input.fixture.tokenizerProxyContainerId,
      label: "tokenizer-proxy",
    }),
  ]);

  return sections.join("\n\n");
}

async function buildFailureDiagnostics(input: {
  websocketTraceEntries: WebSocketTraceEntry[];
  fixture?: Pick<
    SystemTestFixture,
    | "controlPlaneApiContainerId"
    | "controlPlaneWorkerContainerId"
    | "dataPlaneApiContainerId"
    | "dataPlaneWorkerContainerId"
    | "dataPlaneGatewayContainerId"
    | "tokenizerProxyContainerId"
  >;
}): Promise<string> {
  let diagnostics = `Websocket trace (tail):\n${formatWebSocketTrace(input.websocketTraceEntries)}`;
  const sandboxListDiagnostics = await collectSandboxContainerListDiagnostics();
  diagnostics = `${diagnostics}\n\nSandbox container diagnostics:\nproviderRuntimeId unavailable\n\nKnown sandbox containers:\n${sandboxListDiagnostics}`;

  if (input.fixture !== undefined) {
    const appContainerDiagnostics = await collectAppContainerDiagnostics({
      fixture: input.fixture,
    });
    diagnostics = `${diagnostics}\n\nApp container diagnostics:\n${appContainerDiagnostics}`;
  }

  return diagnostics;
}

async function runSandboxScenario(input: {
  fixture: SystemTestFixture;
  includeAppContainerDiagnostics?: boolean;
  action: (context: SandboxScenarioContext) => Promise<void>;
}): Promise<void> {
  const stepTrace: StepTraceEntry[] = [];
  const websocketTraceEntries: WebSocketTraceEntry[] = [];
  let websocketForCleanup: WebSocket | null = null;
  let detachWebSocketTrace: () => void = () => {};

  try {
    await input.action({
      stepTrace,
      websocketTraceEntries,
      registerWebsocketCleanup: (cleanup) => {
        websocketForCleanup = cleanup.socket;
        detachWebSocketTrace = cleanup.detachTrace;
      },
    });
  } catch (error) {
    const diagnostics = await buildFailureDiagnostics({
      websocketTraceEntries,
      ...(input.includeAppContainerDiagnostics === true
        ? {
            fixture: input.fixture,
          }
        : {}),
    });

    throw new Error(
      `System test failed. Step trace: ${formatStepTrace(stepTrace)}. Cause: ${describeUnknownError(error)}\n\nDiagnostics:\n${diagnostics}`,
    );
  } finally {
    detachWebSocketTrace();
    if (websocketForCleanup !== null) {
      await closeWebSocket(websocketForCleanup);
    }
  }
}

async function waitForCondition<T>(input: {
  description: string;
  timeoutMs: number;
  evaluate: () => Promise<T | null>;
}): Promise<T> {
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (Date.now() < deadlineEpochMs) {
    const result = await input.evaluate();
    if (result !== null) {
      return result;
    }

    await systemSleeper.sleep(2_000);
  }

  throw new Error(`Timed out waiting for ${input.description} after ${String(input.timeoutMs)}ms.`);
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
  streamId: number;
  timeoutMs: number;
}): Promise<void> {
  const deadline = Date.now() + input.timeoutMs;

  while (true) {
    const nextMessage = await waitForNextWebSocketJsonMessage(
      input.socket,
      remainingTimeMs(deadline),
    );

    const streamOpenOK = StreamOpenOKSchema.safeParse(nextMessage);
    if (streamOpenOK.success && streamOpenOK.data.streamId === input.streamId) {
      return;
    }

    const streamOpenError = StreamOpenErrorSchema.safeParse(nextMessage);
    if (streamOpenError.success && streamOpenError.data.streamId === input.streamId) {
      throw new Error(
        `Tunnel stream.open failed with code '${streamOpenError.data.code}': ${streamOpenError.data.message}`,
      );
    }

    if (remainingTimeMs(deadline) === 0) {
      throw new Error("Timed out waiting for tunnel stream.open acknowledgement.");
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

function collectCommandExecutionItem(input: {
  method: string;
  params: unknown;
  sink: CommandExecutionItem[];
}): void {
  if (input.method !== "item/completed" || !isRecord(input.params)) {
    return;
  }

  const item = input.params.item;
  if (!isRecord(item)) {
    return;
  }

  const itemType = readOptionalStringField(item, "type");
  if (itemType !== "commandExecution") {
    return;
  }

  input.sink.push({
    command: readNonEmptyStringField(item, "command"),
    aggregatedOutput: readOptionalStringField(item, "aggregatedOutput"),
    exitCode: readOptionalNumberField(item, "exitCode"),
    status: readOptionalStringField(item, "status"),
  });
}

async function waitForTurnCompletion(input: {
  socket: WebSocket;
  turnId: string;
  timeoutMs: number;
  agentTextSink: string[];
  commandExecutionSink?: CommandExecutionItem[];
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
    if (input.commandExecutionSink !== undefined) {
      collectCommandExecutionItem({
        method: notification.data.method,
        params: notification.data.params,
        sink: input.commandExecutionSink,
      });
    }

    const completion = parseTurnCompletedNotification(nextMessage);
    if (completion !== null && completion.turnId === input.turnId) {
      return completion;
    }

    if (remainingTimeMs(deadline) === 0) {
      throw new Error(`Timed out waiting for turn/completed for turn '${input.turnId}'.`);
    }
  }
}

function readCommandExecutionItemsForTurn(input: {
  threadReadResult: unknown;
  turnId: string;
}): CommandExecutionItem[] {
  const parsedThreadReadResult = ThreadReadResultSchema.safeParse(input.threadReadResult);
  if (!parsedThreadReadResult.success) {
    throw new Error(
      `thread/read result did not match expected schema: ${formatJsonForError(input.threadReadResult)}`,
    );
  }

  const turn = (parsedThreadReadResult.data.thread.turns ?? []).find(
    (candidateTurn) => candidateTurn.id === input.turnId,
  );
  if (turn === undefined) {
    throw new Error(`thread/read result did not include target turn '${input.turnId}'.`);
  }

  const items = turn.items ?? [];
  const commandExecutions: CommandExecutionItem[] = [];
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const itemType = readOptionalStringField(item, "type");
    if (itemType !== "commandExecution") {
      continue;
    }

    commandExecutions.push({
      command: readNonEmptyStringField(item, "command"),
      aggregatedOutput: readOptionalStringField(item, "aggregatedOutput"),
      exitCode: readOptionalNumberField(item, "exitCode"),
      status: readOptionalStringField(item, "status"),
    });
  }

  return commandExecutions;
}

function readLocalImagePathsForTurn(input: {
  threadReadResult: unknown;
  turnId: string;
}): string[] {
  const parsedThreadReadResult = ThreadReadResultSchema.safeParse(input.threadReadResult);
  if (!parsedThreadReadResult.success) {
    throw new Error(
      `thread/read result did not match expected schema: ${formatJsonForError(input.threadReadResult)}`,
    );
  }

  const turn = (parsedThreadReadResult.data.thread.turns ?? []).find(
    (candidateTurn) => candidateTurn.id === input.turnId,
  );
  if (turn === undefined) {
    throw new Error(`thread/read result did not include target turn '${input.turnId}'.`);
  }

  const localImagePaths: string[] = [];
  for (const item of turn.items ?? []) {
    if (!isRecord(item) || readOptionalStringField(item, "type") !== "userMessage") {
      continue;
    }

    const content = item["content"];
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      if (!isRecord(contentItem) || readOptionalStringField(contentItem, "type") !== "localImage") {
        continue;
      }

      const path = readOptionalStringField(contentItem, "path");
      if (path !== null) {
        localImagePaths.push(path);
      }
    }
  }

  return localImagePaths;
}

async function waitForLocalImagePathOnTurn(input: {
  socket: WebSocket;
  streamId: number;
  threadId: string;
  turnId: string;
  expectedPath: string;
  timeoutMs: number;
}): Promise<void> {
  await waitForCondition({
    description: `localImage path '${input.expectedPath}' to appear on thread '${input.threadId}'`,
    timeoutMs: input.timeoutMs,
    evaluate: async () => {
      sendAgentJson(input.socket, input.streamId, {
        method: "thread/read",
        id: 3,
        params: {
          threadId: input.threadId,
          includeTurns: true,
        },
      });
      const threadReadResult = await waitForJsonRpcResult({
        socket: input.socket,
        requestId: 3,
        timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
      });

      return readLocalImagePathsForTurn({
        threadReadResult,
        turnId: input.turnId,
      }).includes(input.expectedPath)
        ? true
        : null;
    },
  });
}

async function mintSandboxWebSocketUrl(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  cookie: string;
  sandboxInstanceId: string;
  dataPlaneGatewayBaseUrl: string;
}): Promise<string> {
  const mintConnectionTokenResponse = await requestWithTimeout({
    request: input.request,
    path: `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/connection-tokens`,
    timeoutMs: MINT_CONNECTION_TOKEN_TIMEOUT_MS,
    description: "sandbox connection token minting",
    init: {
      method: "POST",
      headers: {
        cookie: input.cookie,
      },
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
  return resolveGatewayWebSocketUrl({
    mintedUrl,
    gatewayBaseUrl: input.dataPlaneGatewayBaseUrl,
  });
}

async function createOpenAiConnection(input: {
  fixture: Pick<SystemTestFixture, "request">;
  authenticatedSession: AuthenticatedFixtureSession;
  openAiApiKey: string;
  displayName: string;
  stepTrace: StepTraceEntry[];
}): Promise<string> {
  const createConnectionResponse = await runStep({
    stepTrace: input.stepTrace,
    stepName: "create OpenAI connection",
    action: async () => {
      return await requestWithTimeout({
        request: input.fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(OPENAI_TARGET_KEY)}/api-key`,
        timeoutMs: CREATE_CONNECTION_TIMEOUT_MS,
        description: "OpenAI API-key connection creation",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: input.authenticatedSession.cookie,
          },
          body: JSON.stringify({
            displayName: input.displayName,
            apiKey: input.openAiApiKey,
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

  return readNonEmptyStringField(createConnectionPayload, "id");
}

async function createSandboxProfile(input: {
  fixture: Pick<SystemTestFixture, "request">;
  authenticatedSession: AuthenticatedFixtureSession;
  displayName: string;
  stepTrace: StepTraceEntry[];
}): Promise<string> {
  const createProfileResponse = await runStep({
    stepTrace: input.stepTrace,
    stepName: "create sandbox profile",
    action: async () => {
      return await requestWithTimeout({
        request: input.fixture.request,
        path: "/v1/sandbox/profiles",
        timeoutMs: CREATE_PROFILE_TIMEOUT_MS,
        description: "sandbox profile creation",
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: input.authenticatedSession.cookie,
          },
          body: JSON.stringify({
            displayName: input.displayName,
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

  return readNonEmptyStringField(createProfilePayload, "id");
}

async function updateSandboxBindings(input: {
  fixture: Pick<SystemTestFixture, "request">;
  authenticatedSession: AuthenticatedFixtureSession;
  profileId: string;
  bindings: unknown[];
  stepTrace: StepTraceEntry[];
  stepName: string;
}): Promise<void> {
  const putBindingsResponse = await runStep({
    stepTrace: input.stepTrace,
    stepName: input.stepName,
    action: async () => {
      return await requestWithTimeout({
        request: input.fixture.request,
        path: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/1/integration-bindings`,
        timeoutMs: PUT_BINDINGS_TIMEOUT_MS,
        description: "sandbox profile integration binding update",
        init: {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: input.authenticatedSession.cookie,
          },
          body: JSON.stringify({
            bindings: input.bindings,
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
}

async function startSandboxInstance(input: {
  fixture: Pick<SystemTestFixture, "request">;
  authenticatedSession: AuthenticatedFixtureSession;
  profileId: string;
  stepTrace: StepTraceEntry[];
}): Promise<string> {
  const startInstanceResponse = await runStep({
    stepTrace: input.stepTrace,
    stepName: "start sandbox instance",
    action: async () => {
      return await requestWithTimeout({
        request: input.fixture.request,
        path: `/v1/sandbox/profiles/${encodeURIComponent(input.profileId)}/versions/1/instances`,
        timeoutMs: START_INSTANCE_TIMEOUT_MS,
        description: "sandbox profile start instance",
        init: {
          method: "POST",
          headers: {
            cookie: input.authenticatedSession.cookie,
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
  const parsedStartInstancePayload =
    StartSandboxInstanceResponseSchema.safeParse(startInstancePayload);
  if (!parsedStartInstancePayload.success) {
    throw new Error("Expected sandbox instance start response to match the API schema.");
  }

  return parsedStartInstancePayload.data.sandboxInstanceId;
}

async function waitForSandboxInstanceRunningStep(input: {
  fixture: Pick<SystemTestFixture, "request">;
  authenticatedSession: AuthenticatedFixtureSession;
  sandboxInstanceId: string;
  stepTrace: StepTraceEntry[];
}): Promise<void> {
  await runStep({
    stepTrace: input.stepTrace,
    stepName: "wait for sandbox instance to reach running",
    action: async () => {
      await waitForSandboxInstanceRunning({
        request: input.fixture.request,
        cookie: input.authenticatedSession.cookie,
        sandboxInstanceId: input.sandboxInstanceId,
        timeoutMs: START_INSTANCE_TIMEOUT_MS,
      });
    },
  });
}

async function connectInitializedAgentSession(input: {
  fixture: Pick<SystemTestFixture, "request">;
  authenticatedSession: AuthenticatedFixtureSession;
  sandboxInstanceId: string;
  dataPlaneGatewayBaseUrl: string;
  stepTrace: StepTraceEntry[];
  websocketTraceEntries: WebSocketTraceEntry[];
  connectStepName?: string;
  initializeStepName?: string;
}): Promise<AgentSocketSession> {
  const websocketUrl = await runStep({
    stepTrace: input.stepTrace,
    stepName: "mint websocket url for agent session",
    action: async () => {
      return await mintSandboxWebSocketUrl({
        request: input.fixture.request,
        cookie: input.authenticatedSession.cookie,
        sandboxInstanceId: input.sandboxInstanceId,
        dataPlaneGatewayBaseUrl: input.dataPlaneGatewayBaseUrl,
      });
    },
  });

  const websocket = await runStep({
    stepTrace: input.stepTrace,
    stepName: input.connectStepName ?? "connect websocket tunnel",
    action: async () => {
      return await connectWebSocket(websocketUrl, WEBSOCKET_CONNECT_TIMEOUT_MS);
    },
  });
  const detachWebSocketTrace = attachWebSocketTrace({
    socket: websocket,
    sink: input.websocketTraceEntries,
  });

  const handshakeStreamId = 1;
  await runStep({
    stepTrace: input.stepTrace,
    stepName: input.initializeStepName ?? "connect and initialize Codex app-server",
    action: async () => {
      sendJson(websocket, {
        type: "stream.open",
        streamId: handshakeStreamId,
        channel: {
          kind: "agent",
        },
      });
      await waitForTunnelHandshakeAck({
        socket: websocket,
        streamId: handshakeStreamId,
        timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
      });

      sendAgentJson(websocket, handshakeStreamId, {
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

      sendAgentJson(websocket, handshakeStreamId, {
        method: "initialized",
        params: {},
      });
    },
  });

  return {
    websocket,
    detachWebSocketTrace,
    handshakeStreamId,
  };
}

async function startThread(input: {
  websocket: WebSocket;
  handshakeStreamId: number;
  model: string;
  stepTrace: StepTraceEntry[];
}): Promise<string> {
  return runStep({
    stepTrace: input.stepTrace,
    stepName: "json-rpc thread/start",
    action: async () => {
      sendAgentJson(input.websocket, input.handshakeStreamId, {
        method: "thread/start",
        id: 1,
        params: {
          model: input.model,
        },
      });
      const threadStartResult = await waitForJsonRpcResult({
        socket: input.websocket,
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
}

async function startTurn(input: {
  websocket: WebSocket;
  handshakeStreamId: number;
  threadId: string;
  requestId: JsonRpcId;
  turnInput: unknown[];
  stepTrace: StepTraceEntry[];
  stepName: string;
  notificationSink?: JsonRpcNotification[];
}): Promise<string> {
  return runStep({
    stepTrace: input.stepTrace,
    stepName: input.stepName,
    action: async () => {
      sendAgentJson(input.websocket, input.handshakeStreamId, {
        method: "turn/start",
        id: input.requestId,
        params: {
          threadId: input.threadId,
          input: input.turnInput,
        },
      });
      const turnStartResult = await waitForJsonRpcResult({
        socket: input.websocket,
        requestId: input.requestId,
        timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
        ...(input.notificationSink === undefined
          ? {}
          : {
              notificationSink: input.notificationSink,
            }),
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
}

async function uploadImageOverTunnel(input: {
  websocketUrl: string;
  threadId: string;
  imageBytes: Uint8Array;
}): Promise<UploadedSandboxImage> {
  const socket = await connectWebSocket(input.websocketUrl, WEBSOCKET_CONNECT_TIMEOUT_MS);
  const websocketTraceEntries: WebSocketTraceEntry[] = [];
  const detachWebSocketTrace = attachWebSocketTrace({
    socket,
    sink: websocketTraceEntries,
  });

  try {
    getWebSocketJsonMessagePump(socket);
    const streamId = 1;
    sendJson(socket, {
      type: "stream.open",
      streamId,
      channel: {
        kind: "fileUpload",
        threadId: input.threadId,
        mimeType: "image/png",
        originalFilename: "system-test.png",
        sizeBytes: input.imageBytes.byteLength,
      },
    });
    await waitForTunnelHandshakeAck({
      socket,
      streamId,
      timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
    });

    socket.send(
      encodeDataFrame({
        streamId,
        payloadKind: PayloadKindRawBytes,
        payload: input.imageBytes,
      }),
    );
    sendJson(socket, {
      type: "stream.close",
      streamId,
    });

    const deadline = Date.now() + WEBSOCKET_MESSAGE_TIMEOUT_MS;
    while (true) {
      const nextMessage = await waitForNextWebSocketJsonMessage(socket, remainingTimeMs(deadline));
      const completion = FileUploadCompletedEventSchema.safeParse(nextMessage);
      if (completion.success && completion.data.streamId === streamId) {
        return {
          attachmentId: completion.data.event.attachmentId,
          path: completion.data.event.path,
        };
      }

      const streamOpenError = StreamOpenErrorSchema.safeParse(nextMessage);
      if (streamOpenError.success && streamOpenError.data.streamId === streamId) {
        throw new Error(
          `Tunnel stream.open failed with code '${streamOpenError.data.code}': ${streamOpenError.data.message}`,
        );
      }

      const streamReset = StreamResetSchema.safeParse(nextMessage);
      if (streamReset.success && streamReset.data.streamId === streamId) {
        throw new Error(
          `Tunnel stream.reset failed with code '${streamReset.data.code}': ${streamReset.data.message}`,
        );
      }

      if (remainingTimeMs(deadline) === 0) {
        throw new Error("Timed out waiting for file upload completion event.");
      }
    }
  } catch (error) {
    throw new Error(
      `Image upload tunnel failed. Upload websocket trace:\n${formatWebSocketTrace(websocketTraceEntries)}`,
      {
        cause: error,
      },
    );
  } finally {
    detachWebSocketTrace();
    await closeWebSocket(socket);
  }
}

async function waitForSandboxInstanceRunning(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  cookie: string;
  sandboxInstanceId: string;
  timeoutMs: number;
}): Promise<z.infer<typeof SandboxInstanceStatusResponseSchema>> {
  const deadline = Date.now() + input.timeoutMs;

  while (true) {
    const response = await requestWithTimeout({
      request: input.request,
      path: `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}`,
      timeoutMs: remainingTimeMs(deadline),
      description: "sandbox instance status lookup",
      init: {
        headers: {
          cookie: input.cookie,
        },
      },
    });
    const payload = await expectStatusJson({
      response,
      status: 200,
      description: "sandbox instance status lookup",
    });
    const parsedPayload = SandboxInstanceStatusResponseSchema.safeParse(payload);
    if (!parsedPayload.success) {
      throw new Error("Expected sandbox instance status response to match the API schema.");
    }

    if (parsedPayload.data.status === "running") {
      return parsedPayload.data;
    }

    if (parsedPayload.data.status === "failed") {
      throw new Error(
        `Sandbox instance failed to provision (${parsedPayload.data.failureCode ?? "unknown"}): ${
          parsedPayload.data.failureMessage ?? "no message"
        }`,
      );
    }

    if (remainingTimeMs(deadline) === 0) {
      throw new Error("Timed out waiting for sandbox instance to reach running state.");
    }

    await systemSleeper.sleep(1_000);
  }
}

describe("system sandbox openai codex app-server websocket tunnel", () => {
  it(
    "connects to an agent endpoint and exchanges Codex app-server JSON-RPC messages",
    async ({ fixture }) => {
      await runSandboxScenario({
        fixture,
        includeAppContainerDiagnostics: true,
        action: async ({ stepTrace, websocketTraceEntries, registerWebsocketCleanup }) => {
          const openAiApiKey = requireEnv(OPENAI_API_KEY_ENV_NAME);
          const dataPlaneGatewayBaseUrl = fixture.dataPlaneGatewayBaseUrl;
          const connectionDisplayName = `System OpenAI Connection ${randomUUID()}`;
          const authenticatedSession = await runStep({
            stepTrace,
            stepName: "create authenticated session",
            action: async () => {
              return await fixture.authSession();
            },
          });

          const connectionId = await createOpenAiConnection({
            fixture,
            authenticatedSession,
            openAiApiKey,
            displayName: connectionDisplayName,
            stepTrace,
          });
          const profileId = await createSandboxProfile({
            fixture,
            authenticatedSession,
            displayName: `System OpenAI App-Server ${randomUUID()}`,
            stepTrace,
          });
          await updateSandboxBindings({
            fixture,
            authenticatedSession,
            profileId,
            stepTrace,
            stepName: "bind OpenAI agent integration",
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
          });
          const sandboxInstanceId = await startSandboxInstance({
            fixture,
            authenticatedSession,
            profileId,
            stepTrace,
          });
          await waitForSandboxInstanceRunningStep({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            stepTrace,
          });

          const agentSession = await connectInitializedAgentSession({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            dataPlaneGatewayBaseUrl,
            stepTrace,
            websocketTraceEntries,
            initializeStepName: "connect and initialize Codex app-server",
          });
          const websocket = agentSession.websocket;
          registerWebsocketCleanup({
            socket: websocket,
            detachTrace: agentSession.detachWebSocketTrace,
          });
          const handshakeStreamId = agentSession.handshakeStreamId;

          const threadId = await startThread({
            websocket,
            handshakeStreamId,
            model: "gpt-5.3-codex",
            stepTrace,
          });

          const notificationsWhileStartingTurn: JsonRpcNotification[] = [];
          const observedCommandExecutions: CommandExecutionItem[] = [];
          const turnId = await startTurn({
            websocket,
            handshakeStreamId,
            threadId,
            requestId: 2,
            stepTrace,
            stepName: "json-rpc turn/start",
            notificationSink: notificationsWhileStartingTurn,
            turnInput: [
              {
                type: "text",
                text: `Reply with exactly ${TEST_RESPONSE_MARKER} and nothing else.`,
              },
            ],
          });

          const agentTextParts: string[] = [];
          let preBufferedTurnCompletion: TurnCompletion | null = null;
          for (const notification of notificationsWhileStartingTurn) {
            collectAgentMessageText({
              method: notification.method,
              params: notification.params,
              sink: agentTextParts,
            });
            collectCommandExecutionItem({
              method: notification.method,
              params: notification.params,
              sink: observedCommandExecutions,
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
                  commandExecutionSink: observedCommandExecutions,
                }))
              );
            },
          });
          expect(turnCompletion.status).toBe("completed");
          expect(turnCompletion.errorMessage).toBeNull();

          const combinedAgentText = agentTextParts.join("");
          expect(combinedAgentText.length).toBeGreaterThan(0);
          expect(combinedAgentText).toContain(TEST_RESPONSE_MARKER);
        },
      });
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );

  it(
    "uploads an image over fileUpload and sends it as localImage turn input",
    async ({ fixture }) => {
      await runSandboxScenario({
        fixture,
        includeAppContainerDiagnostics: true,
        action: async ({ stepTrace, websocketTraceEntries, registerWebsocketCleanup }) => {
          const openAiApiKey = requireEnv(OPENAI_API_KEY_ENV_NAME);
          const dataPlaneGatewayBaseUrl = fixture.dataPlaneGatewayBaseUrl;
          const connectionDisplayName = `System OpenAI Image Connection ${randomUUID()}`;
          const authenticatedSession = await runStep({
            stepTrace,
            stepName: "create authenticated session",
            action: async () => {
              return await fixture.authSession();
            },
          });

          const connectionId = await createOpenAiConnection({
            fixture,
            authenticatedSession,
            openAiApiKey,
            displayName: connectionDisplayName,
            stepTrace,
          });
          const profileId = await createSandboxProfile({
            fixture,
            authenticatedSession,
            displayName: `System OpenAI Image App-Server ${randomUUID()}`,
            stepTrace,
          });
          await updateSandboxBindings({
            fixture,
            authenticatedSession,
            profileId,
            stepTrace,
            stepName: "bind OpenAI agent integration",
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
          });
          const sandboxInstanceId = await startSandboxInstance({
            fixture,
            authenticatedSession,
            profileId,
            stepTrace,
          });
          await waitForSandboxInstanceRunningStep({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            stepTrace,
          });

          const agentSession = await connectInitializedAgentSession({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            dataPlaneGatewayBaseUrl,
            stepTrace,
            websocketTraceEntries,
          });
          const websocket = agentSession.websocket;
          registerWebsocketCleanup({
            socket: websocket,
            detachTrace: agentSession.detachWebSocketTrace,
          });
          const handshakeStreamId = agentSession.handshakeStreamId;

          const threadId = await startThread({
            websocket,
            handshakeStreamId,
            model: "gpt-5.3-codex",
            stepTrace,
          });

          const uploadedImage = await runStep({
            stepTrace,
            stepName: "upload image over fileUpload tunnel",
            action: async () => {
              const uploadWebsocketUrl = await mintSandboxWebSocketUrl({
                request: fixture.request,
                cookie: authenticatedSession.cookie,
                sandboxInstanceId,
                dataPlaneGatewayBaseUrl,
              });

              return await uploadImageOverTunnel({
                websocketUrl: uploadWebsocketUrl,
                threadId,
                imageBytes: new Uint8Array(TinyPngBytes),
              });
            },
          });

          const notificationsWhileStartingTurn: JsonRpcNotification[] = [];
          const turnId = await startTurn({
            websocket,
            handshakeStreamId,
            threadId,
            requestId: 2,
            stepTrace,
            stepName: "json-rpc turn/start with localImage input",
            notificationSink: notificationsWhileStartingTurn,
            turnInput: [
              {
                type: "text",
                text: "Reply with exactly IMAGE_INPUT_OK and nothing else.",
              },
              {
                type: "localImage",
                path: uploadedImage.path,
              },
            ],
          });

          await runStep({
            stepTrace,
            stepName: "wait for localImage input to persist on thread",
            action: async () => {
              await waitForLocalImagePathOnTurn({
                socket: websocket,
                streamId: handshakeStreamId,
                threadId,
                turnId,
                expectedPath: uploadedImage.path,
                timeoutMs: TURN_COMPLETION_TIMEOUT_MS,
              });
            },
          });
        },
      });
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});

const describeIfGitHubEnv = hasRequiredGitHubEnv() ? describe : describe.skip;

describeIfGitHubEnv("system sandbox openai codex app-server with github binding", () => {
  it(
    "lets Codex detect the GitHub CLI binary through a shell tool call",
    async ({ fixture }) => {
      await runSandboxScenario({
        fixture,
        includeAppContainerDiagnostics: true,
        action: async ({ stepTrace, websocketTraceEntries, registerWebsocketCleanup }) => {
          const openAiApiKey = requireEnv(OPENAI_API_KEY_ENV_NAME);
          const repository = parseGitHubRepository(requireEnv(GITHUB_TEST_REPOSITORY_ENV_NAME));
          const githubInstallationId = requireEnv(GITHUB_INSTALLATION_ID_ENV_NAME);
          const dataPlaneGatewayBaseUrl = fixture.dataPlaneGatewayBaseUrl;
          const authenticatedSession = await runStep({
            stepTrace,
            stepName: "create authenticated session",
            action: async () => {
              return await fixture.authSession();
            },
          });

          const openAiConnectionId = await createOpenAiConnection({
            fixture,
            authenticatedSession,
            openAiApiKey,
            displayName: `System OpenAI Connection ${randomUUID()}`,
            stepTrace,
          });

          const githubConnectionId = await runStep({
            stepTrace,
            stepName: "create GitHub connection",
            action: async () => {
              const startResponse = await requestWithTimeout({
                request: fixture.request,
                path: `/v1/integration/connections/${encodeURIComponent(GITHUB_TARGET_KEY)}/github-app-installation/start`,
                timeoutMs: CREATE_CONNECTION_TIMEOUT_MS,
                description: "GitHub App installation start",
                init: {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    cookie: authenticatedSession.cookie,
                  },
                  body: JSON.stringify({
                    displayName: `GitHub Codex System Test ${randomUUID()}`,
                  }),
                },
              });
              const startPayload = await expectStatusJson({
                response: startResponse,
                status: 200,
                description: "GitHub App installation start",
              });
              const parsedStartPayload =
                StartRedirectConnectionResponseSchema.safeParse(startPayload);
              if (!parsedStartPayload.success) {
                throw new Error(
                  `GitHub App installation start response did not match schema: ${formatJsonForError(startPayload)}`,
                );
              }

              const githubOauthState = new URL(
                parsedStartPayload.data.authorizationUrl,
              ).searchParams.get("state");
              if (githubOauthState === null || githubOauthState.length === 0) {
                throw new Error(
                  "Expected GitHub App installation start response to include a non-empty state.",
                );
              }

              const completeResponse = await requestWithTimeout({
                request: fixture.request,
                path: createGitHubAppInstallationCompletePath({
                  targetKey: GITHUB_TARGET_KEY,
                  query: {
                    state: githubOauthState,
                    installation_id: githubInstallationId,
                    setup_action: "install",
                  },
                }),
                timeoutMs: CREATE_CONNECTION_TIMEOUT_MS,
                description: "GitHub App installation completion",
                init: {
                  method: "GET",
                  headers: {
                    cookie: authenticatedSession.cookie,
                  },
                  redirect: "manual",
                },
              });
              if (completeResponse.status !== 302) {
                const responseBody = await completeResponse.text().catch(() => "");
                throw new Error(
                  `GitHub App installation completion expected status 302, got ${String(completeResponse.status)}. Response body: ${responseBody}`,
                );
              }

              const connection = await waitForCondition({
                description: "persisted GitHub connection to be created",
                timeoutMs: CREATE_CONNECTION_TIMEOUT_MS,
                evaluate: async () => {
                  return (
                    (await fixture.db.query.integrationConnections.findFirst({
                      where: (table, { and, eq }) =>
                        and(
                          eq(table.organizationId, authenticatedSession.organizationId),
                          eq(table.targetKey, GITHUB_TARGET_KEY),
                          eq(table.externalSubjectId, githubInstallationId),
                        ),
                    })) ?? null
                  );
                },
              });

              return connection.id;
            },
          });

          await runStep({
            stepTrace,
            stepName: "refresh GitHub repository resources",
            action: async () => {
              const response = await requestWithTimeout({
                request: fixture.request,
                path: `/v1/integration/connections/${encodeURIComponent(githubConnectionId)}/resources/repository/refresh`,
                timeoutMs: CREATE_CONNECTION_TIMEOUT_MS,
                description: "GitHub repository resource refresh",
                init: {
                  method: "POST",
                  headers: {
                    cookie: authenticatedSession.cookie,
                  },
                },
              });
              const payload = await expectStatusJson({
                response,
                status: 202,
                description: "GitHub repository resource refresh",
              });
              const parsedPayload =
                RefreshIntegrationConnectionResourcesResponseSchema.safeParse(payload);
              if (!parsedPayload.success) {
                throw new Error(
                  `GitHub repository refresh response did not match schema: ${formatJsonForError(payload)}`,
                );
              }
            },
          });

          await runStep({
            stepTrace,
            stepName: "wait for GitHub repository resource sync",
            action: async () => {
              await waitForCondition({
                description: "GitHub repository resource sync to reach ready",
                timeoutMs: RESOURCE_SYNC_TIMEOUT_MS,
                evaluate: async () => {
                  const resourceState =
                    await fixture.db.query.integrationConnectionResourceStates.findFirst({
                      where: (table, { and, eq }) =>
                        and(
                          eq(table.connectionId, githubConnectionId),
                          eq(table.kind, "repository"),
                        ),
                    });

                  if (resourceState === undefined) {
                    return null;
                  }

                  if (resourceState.syncState === "error") {
                    throw new Error(
                      `GitHub resource sync failed: ${resourceState.lastErrorCode ?? "unknown"} ${resourceState.lastErrorMessage ?? ""}`,
                    );
                  }

                  if (resourceState.syncState !== "ready") {
                    return null;
                  }

                  const resource = await fixture.db.query.integrationConnectionResources.findFirst({
                    where: (table, { and, eq }) =>
                      and(
                        eq(table.connectionId, githubConnectionId),
                        eq(table.kind, "repository"),
                        eq(table.handle, `${repository.owner}/${repository.repo}`),
                      ),
                  });

                  return resource === undefined ? null : resource;
                },
              });
            },
          });

          const profileId = await createSandboxProfile({
            fixture,
            authenticatedSession,
            displayName: `System OpenAI App-Server GitHub ${randomUUID()}`,
            stepTrace,
          });

          await updateSandboxBindings({
            fixture,
            authenticatedSession,
            profileId,
            stepTrace,
            stepName: "bind OpenAI and GitHub integrations",
            bindings: [
              {
                connectionId: openAiConnectionId,
                kind: "agent",
                config: {
                  runtime: "codex-cli",
                  defaultModel: "gpt-5.3-codex",
                  reasoningEffort: "medium",
                },
              },
              {
                connectionId: githubConnectionId,
                kind: "git",
                config: {
                  repositories: [`${repository.owner}/${repository.repo}`],
                },
              },
            ],
          });

          const sandboxInstanceId = await startSandboxInstance({
            fixture,
            authenticatedSession,
            profileId,
            stepTrace,
          });

          await waitForSandboxInstanceRunningStep({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            stepTrace,
          });

          const agentSession = await connectInitializedAgentSession({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            dataPlaneGatewayBaseUrl,
            stepTrace,
            websocketTraceEntries,
          });
          const websocket = agentSession.websocket;
          registerWebsocketCleanup({
            socket: websocket,
            detachTrace: agentSession.detachWebSocketTrace,
          });
          const handshakeStreamId = agentSession.handshakeStreamId;

          const threadId = await startThread({
            websocket,
            handshakeStreamId,
            model: "gpt-5.3-codex",
            stepTrace,
          });

          const notificationsWhileStartingTurn: JsonRpcNotification[] = [];
          const observedCommandExecutions: CommandExecutionItem[] = [];
          const turnId = await startTurn({
            websocket,
            handshakeStreamId,
            threadId,
            requestId: 2,
            stepTrace,
            stepName: "json-rpc turn/start",
            notificationSink: notificationsWhileStartingTurn,
            turnInput: [
              {
                type: "text",
                text: [
                  "Use the shell tool to run exactly `command -v gh`.",
                  `If it prints exactly ${GITHUB_BINARY_PATH}, reply with exactly ${GITHUB_TEST_RESPONSE_MARKER}.`,
                  "If it does not, reply with exactly GH_MISSING.",
                  "Do not use any other tool and do not add extra text.",
                ].join(" "),
              },
            ],
          });

          const agentTextParts: string[] = [];
          let preBufferedTurnCompletion: TurnCompletion | null = null;
          for (const notification of notificationsWhileStartingTurn) {
            collectAgentMessageText({
              method: notification.method,
              params: notification.params,
              sink: agentTextParts,
            });
            collectCommandExecutionItem({
              method: notification.method,
              params: notification.params,
              sink: observedCommandExecutions,
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
                  commandExecutionSink: observedCommandExecutions,
                }))
              );
            },
          });
          expect(turnCompletion.status).toBe("completed");
          expect(turnCompletion.errorMessage).toBeNull();

          const combinedAgentText = agentTextParts.join("");
          expect(combinedAgentText).toContain(GITHUB_TEST_RESPONSE_MARKER);

          const commandExecutionItems: CommandExecutionItem[] =
            observedCommandExecutions.length > 0
              ? observedCommandExecutions
              : readCommandExecutionItemsForTurn({
                  threadReadResult: await runStep({
                    stepTrace,
                    stepName: "json-rpc thread/read",
                    action: async () => {
                      sendAgentJson(websocket, handshakeStreamId, {
                        method: "thread/read",
                        id: 3,
                        params: {
                          threadId,
                          includeTurns: true,
                        },
                      });
                      return await waitForJsonRpcResult({
                        socket: websocket,
                        requestId: 3,
                        timeoutMs: WEBSOCKET_MESSAGE_TIMEOUT_MS,
                      });
                    },
                  }),
                  turnId,
                });
          expect(commandExecutionItems.length).toBeGreaterThan(0);

          const ghDetectionCommand = commandExecutionItems.find((item: CommandExecutionItem) =>
            item.command.includes("command -v gh"),
          );
          expect(ghDetectionCommand).toBeDefined();
          if (ghDetectionCommand === undefined) {
            throw new Error(
              `Expected Codex to execute 'command -v gh'. Commands: ${formatJsonForError(commandExecutionItems)}`,
            );
          }

          expect(ghDetectionCommand.status).toBe("completed");
          expect(ghDetectionCommand.exitCode).toBe(0);
          expect(ghDetectionCommand.aggregatedOutput).not.toBeNull();
          expect(ghDetectionCommand.aggregatedOutput?.trim()).toBe(GITHUB_BINARY_PATH);
        },
      });
    },
    SYSTEM_TEST_TIMEOUT_MS * 2,
  );
});
