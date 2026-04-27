/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)` and
 * object-destructuring fixture signatures.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createControlPlaneDatabase, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { createDataPlaneDatabase, type DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  decodeDataFrame,
  encodeDataFrame,
  PayloadKindRawBytes,
  parseBootstrapControlMessage,
  type BootstrapControlMessage,
} from "@mistle/sandbox-session-protocol";
import { createMailpitInbox, readTestContext } from "@mistle/test-harness";
import { systemClock, systemSleeper } from "@mistle/time";
import { Sandbox, type ConnectionOpts } from "e2b";
import { Pool } from "pg";
import { it as vitestIt } from "vitest";
import { z } from "zod";

import { SandboxRuntimeStateSnapshotSchema } from "../../packages/sandbox-runtime-contract/src/index.js";
import {
  createControlPlaneApiClient,
  type ControlPlaneApiClient,
} from "./control-plane-api-client.js";

export type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

export type SystemTestFixture = {
  sandboxProvider: "docker" | "e2b";
  controlPlaneApiBaseUrl: string;
  controlPlaneApiContainerId: string;
  controlPlaneWorkerBaseUrl: string;
  controlPlaneWorkerContainerId: string;
  dataPlaneApiBaseUrl: string;
  dataPlaneApiContainerId: string;
  dataPlaneWorkerBaseUrl: string;
  dataPlaneWorkerContainerId: string;
  dataPlaneGatewayBaseUrl: string;
  dataPlaneGatewayContainerId: string;
  tokenizerProxyBaseUrl: string;
  tokenizerProxyContainerId: string;
  controlPlaneDatabaseUrl: string;
  internalAuthServiceToken: string;
  otlpTraceCaptureFilePath: string;
  dataPlaneGatewayIdleTimeoutMs: number;
  dataPlaneGatewayBootstrapDisconnectGraceMs: number;
  controlPlaneApiClient: ControlPlaneApiClient;
  db: ControlPlaneDatabase;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  sendSignInOtp: (input: { email: string }) => Promise<Response>;
  waitForSignInOtp: (input: { email: string }) => Promise<string>;
  signInWithOtp: (input: { email: string; otp: string }) => Promise<Response>;
  readRequestCookie: (signInResponse: Response) => string;
  createOrganization: (input: { cookie: string; name: string; slug: string }) => Promise<string>;
  authSession: (input?: { email?: string }) => Promise<AuthenticatedSession>;
  enableManagedPersistentSandboxes: (input: { cookie: string }) => Promise<void>;
  startSandboxAndWaitReady: () => Promise<string>;
  runSandboxPtyCommand: (input: {
    sandboxInstanceId: string;
    command: string;
    cwd?: string;
    timeoutMs?: number;
  }) => Promise<{ exitCode: number; output: string }>;
  openPtyAndAssertRoundTrip: (sandboxInstanceId: string) => Promise<void>;
  restartContainer: (
    containerId: string,
    options?: {
      timeoutSeconds?: number;
    },
  ) => Promise<void>;
  stopContainer: (containerId: string) => Promise<void>;
  startContainer: (containerId: string) => Promise<void>;
  waitForSandboxStatus: (
    sandboxInstanceId: string,
    status: "pending" | "starting" | "running" | "stopped" | "failed",
  ) => Promise<SystemSandboxInstanceStatus>;
  waitForSandboxConnectable: (
    sandboxInstanceId: string,
    connectable: boolean,
  ) => Promise<SystemSandboxInstanceStatus>;
  waitForSandboxRuntimeAttachment: (
    sandboxInstanceId: string,
    attached: boolean,
  ) => Promise<z.infer<typeof SandboxRuntimeStateSnapshotSchema>>;
  waitForSandboxRuntimeReady: (
    sandboxInstanceId: string,
    ready: boolean,
  ) => Promise<z.infer<typeof SandboxRuntimeStateSnapshotSchema>>;
  readSandboxRuntimeState: (
    sandboxInstanceId: string,
  ) => Promise<z.infer<typeof SandboxRuntimeStateSnapshotSchema>>;
  stopSandboxInstance: (input: {
    sandboxInstanceId: string;
    idempotencyKey?: string;
  }) => Promise<{ sandboxInstanceId: string; workflowRunId: string }>;
  resumeSandboxInstance: (input: {
    sandboxInstanceId: string;
    idempotencyKey?: string;
  }) => Promise<{ sandboxInstanceId: string; workflowRunId: string }>;
};

const AUTH_OTP_LENGTH = 6;
const AUTH_ORIGIN = "http://localhost:5100";
const InternalAuthServiceTokenHeader = "x-mistle-service-token";
const OpenAiTargetKey = "openai-default";
const OpenAiConnectionMethodId = "api-key";
const OpenAiApiKey = "sk-system-sandbox-restart";
const SandboxReadyTimeoutMs = 3 * 60_000;
const SandboxStatusPollIntervalMs = 1_000;
const PtyRoundTripTimeoutMs = 30_000;
const PtyCommandDefaultTimeoutMs = 60_000;
const WebSocketConnectTimeoutMs = 30_000;
const TestContextId = "system";
const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../..", import.meta.url));
const execFileAsync = promisify(execFile);
const TerminalControlSequencePattern = new RegExp(
  String.raw`\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])`,
  "g",
);

const SandboxProfileResponseSchema = z.object({
  id: z.string().min(1),
});

const IntegrationConnectionResponseSchema = z.object({
  id: z.string().min(1),
});

const SandboxBindingsResponseSchema = z.object({
  bindings: z.array(z.unknown()),
});

const StartSandboxInstanceResponseSchema = z.object({
  status: z.literal("accepted"),
  workflowRunId: z.string().min(1),
  sandboxInstanceId: z.string().min(1),
});

const SandboxInstanceStatusResponseSchema = z.looseObject({
  id: z.string().min(1),
  status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
  connectable: z.boolean(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
});

const SandboxInstanceConnectionTokenResponseSchema = z.object({
  instanceId: z.string().min(1),
  url: z.url(),
  token: z.string().min(1),
  expiresAt: z.string().min(1),
});

const StopSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const ResumeSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const OrganizationSandboxStorageSettingsResponseSchema = z
  .object({
    persistentSandboxesEnabled: z.boolean(),
    storageConfigSource: z.enum(["managed", "organization"]),
    storageBackend: z.enum(["archil"]).nullable(),
    storageConfigVersion: z.number().int().nullable(),
    organizationStorageConfigSummary: z.unknown().nullable(),
  })
  .strict();

type SystemSandboxInstanceStatus = z.infer<typeof SandboxInstanceStatusResponseSchema>;

type SandboxControlContext = {
  session: AuthenticatedSession;
  sandboxProfileId: string;
};

type QueuedPtyFrame =
  | {
      kind: "control";
      payload: BootstrapControlMessage;
    }
  | {
      kind: "binary";
      text: string;
    }
  | {
      kind: "error";
      error: Error;
    };

type PendingPtyFrameWaiter = {
  resolve: (frame: QueuedPtyFrame) => void;
  reject: (error: Error) => void;
  timeoutSignal: AbortSignal;
  onTimeout: () => void;
};

type PtyFramePump = {
  queue: QueuedPtyFrame[];
  waiters: PendingPtyFrameWaiter[];
};

class RetryableWaitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RetryableWaitError";
  }
}

export const SystemTestContextSchema = z
  .object({
    sandboxProvider: z.enum(["docker", "e2b"]),
    controlPlaneApiBaseUrl: z.url(),
    controlPlaneApiContainerId: z.string().min(1),
    controlPlaneWorkerBaseUrl: z.url(),
    controlPlaneWorkerContainerId: z.string().min(1),
    dataPlaneApiBaseUrl: z.url(),
    dataPlaneApiContainerId: z.string().min(1),
    dataPlaneWorkerBaseUrl: z.url(),
    dataPlaneWorkerContainerId: z.string().min(1),
    dataPlaneGatewayBaseUrl: z.url(),
    dataPlaneGatewayContainerId: z.string().min(1),
    tokenizerProxyBaseUrl: z.url(),
    tokenizerProxyContainerId: z.string().min(1),
    mailpitHttpBaseUrl: z.url(),
    controlPlaneDatabaseUrl: z.string().min(1),
    internalAuthServiceToken: z.string().min(1),
    otlpTraceCaptureFilePath: z.string().min(1),
    sandboxNetworkName: z.string().min(1),
    dataPlaneGatewayIdleTimeoutMs: z.number().int().positive(),
    dataPlaneGatewayBootstrapDisconnectGraceMs: z.number().int().positive(),
  })
  .strict();

export type SystemTestContext = z.infer<typeof SystemTestContextSchema>;

export async function readSystemTestContext(): Promise<SystemTestContext> {
  return readTestContext({
    id: TestContextId,
    schema: SystemTestContextSchema,
  });
}

function extractOTPCode(text: string): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(AUTH_OTP_LENGTH)}})\\b`);
  const match = text.match(pattern);

  return match?.[1];
}

function extractRequestCookie(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

function readOrganizationIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const id = Reflect.get(payload, "id");
  return typeof id === "string" && id.length > 0 ? id : null;
}

function generateAuthEmail(): string {
  return `system-auth-${randomUUID()}@example.com`;
}

function createRequestFn(baseUrl: string): (path: string, init?: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return fetch(`${baseUrl}${normalizedPath}`, init);
  };
}

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

async function requestJsonOrThrow<T>(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  path: string;
  expectedStatus: number;
  description: string;
  schema: z.ZodType<T>;
  init?: RequestInit;
}): Promise<T> {
  const response = await input.request(input.path, input.init);
  const bodyText = await response.text().catch(() => "");
  if (response.status !== input.expectedStatus) {
    throw new Error(
      `Expected ${input.description} status ${String(input.expectedStatus)}, got ${String(response.status)}. Response body: ${bodyText}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(
      `${input.description} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return input.schema.parse(parsed);
}

function resolveGatewayTunnelWebSocketUrl(input: {
  mintedUrl: string;
  gatewayBaseUrl: string;
}): string {
  const mintedUrl = new URL(input.mintedUrl);
  const gatewayBaseUrl = new URL(input.gatewayBaseUrl);

  if (gatewayBaseUrl.protocol === "http:") {
    mintedUrl.protocol = "ws:";
  } else if (gatewayBaseUrl.protocol === "https:") {
    mintedUrl.protocol = "wss:";
  } else {
    throw new Error(`Unsupported gateway protocol '${gatewayBaseUrl.protocol}'.`);
  }

  mintedUrl.hostname = gatewayBaseUrl.hostname;
  mintedUrl.port = gatewayBaseUrl.port;

  return mintedUrl.toString();
}

function escapeRegex(input: string): string {
  return input.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTerminalControlSequences(input: string): string {
  return input.replaceAll(TerminalControlSequencePattern, "");
}

async function connectWebSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    const cleanup = (): void => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
      timeoutSignal.removeEventListener("abort", onTimeout);
    };

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

    const onClose = (): void => {
      cleanup();
      reject(new Error("Websocket connection closed before open."));
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

    const cleanup = (): void => {
      socket.removeEventListener("close", onClose);
      timeoutSignal.removeEventListener("abort", onTimeout);
    };

    const onTimeout = (): void => {
      cleanup();
      resolve();
    };

    const onClose = (): void => {
      cleanup();
      resolve();
    };

    socket.addEventListener("close", onClose, { once: true });
    timeoutSignal.addEventListener("abort", onTimeout, { once: true });
    socket.close();
  });
}

async function websocketDataToUint8Array(data: unknown): Promise<Uint8Array> {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }

  throw new Error(`Unsupported websocket binary data type: ${String(typeof data)}.`);
}

function parseControlMessage(payload: string): BootstrapControlMessage {
  const parsed = parseBootstrapControlMessage(payload);
  if (parsed === undefined) {
    throw new Error(`Unexpected websocket control message: ${payload}`);
  }

  return parsed;
}

function drainPtyFramePump(pump: PtyFramePump): void {
  while (pump.waiters.length > 0 && pump.queue.length > 0) {
    const waiter = pump.waiters.shift();
    const frame = pump.queue.shift();
    if (waiter === undefined || frame === undefined) {
      return;
    }

    waiter.timeoutSignal.removeEventListener("abort", waiter.onTimeout);
    if (frame.kind === "error") {
      waiter.reject(frame.error);
      continue;
    }
    waiter.resolve(frame);
  }
}

function createPtyFramePump(socket: WebSocket): PtyFramePump {
  const pump: PtyFramePump = {
    queue: [],
    waiters: [],
  };

  const enqueue = (frame: QueuedPtyFrame): void => {
    pump.queue.push(frame);
    drainPtyFramePump(pump);
  };

  const onMessage = (event: MessageEvent): void => {
    void (async () => {
      try {
        if (typeof event.data === "string") {
          enqueue({
            kind: "control",
            payload: parseControlMessage(event.data),
          });
          return;
        }

        const dataFrame = decodeDataFrame(await websocketDataToUint8Array(event.data));
        if (socket.readyState === WebSocket.OPEN) {
          sendJson(socket, {
            type: "stream.window",
            streamId: dataFrame.streamId,
            bytes: dataFrame.payload.length,
          });
        }
        enqueue({
          kind: "binary",
          text: Buffer.from(dataFrame.payload).toString("utf8"),
        });
      } catch (error) {
        enqueue({
          kind: "error",
          error: new Error(
            `Failed to decode websocket frame: ${
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
      error: new Error("Websocket emitted error while waiting for PTY frames."),
    });
  };

  const onClose = (): void => {
    enqueue({
      kind: "error",
      error: new Error("Websocket closed while waiting for PTY frames."),
    });
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);

  return pump;
}

async function waitForNextPtyFrame(pump: PtyFramePump, timeoutMs: number): Promise<QueuedPtyFrame> {
  const queued = pump.queue.shift();
  if (queued !== undefined) {
    if (queued.kind === "error") {
      throw queued.error;
    }
    return queued;
  }

  if (timeoutMs <= 0) {
    throw new Error(`Timed out after ${String(timeoutMs)}ms waiting for PTY frame.`);
  }

  const nextFrame = await new Promise<QueuedPtyFrame>((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const waiter: PendingPtyFrameWaiter = {
      resolve,
      reject,
      timeoutSignal,
      onTimeout: () => {
        const waiterIndex = pump.waiters.indexOf(waiter);
        if (waiterIndex >= 0) {
          pump.waiters.splice(waiterIndex, 1);
        }
        reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for PTY frame.`));
      },
    };

    pump.waiters.push(waiter);
    timeoutSignal.addEventListener("abort", waiter.onTimeout, { once: true });
  });

  if (nextFrame.kind === "error") {
    throw nextFrame.error;
  }

  return nextFrame;
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error(`Websocket is not open. Current readyState: ${String(socket.readyState)}.`);
  }

  socket.send(JSON.stringify(payload));
}

function sendPtyInput(input: { socket: WebSocket; streamId: number; payload: string }): void {
  if (input.socket.readyState !== WebSocket.OPEN) {
    throw new Error(
      `Websocket is not open. Current readyState: ${String(input.socket.readyState)}.`,
    );
  }

  input.socket.send(
    Buffer.from(
      encodeDataFrame({
        streamId: input.streamId,
        payloadKind: PayloadKindRawBytes,
        payload: new TextEncoder().encode(input.payload),
      }),
    ),
  );
}

async function connectPtyChannel(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  cwd: string;
}): Promise<number> {
  const streamId = 1;
  sendJson(input.socket, {
    type: "stream.open",
    streamId,
    channel: {
      kind: "pty",
      session: "create",
      ptySessionId: "terminal",
      cols: 120,
      rows: 40,
      cwd: input.cwd,
    },
  });

  while (true) {
    const frame = await waitForNextPtyFrame(input.pump, PtyRoundTripTimeoutMs);
    if (frame.kind !== "control") {
      continue;
    }
    if (frame.payload.type === "stream.open.ok" && frame.payload.streamId === streamId) {
      return streamId;
    }
    if (frame.payload.type === "stream.open.error" && frame.payload.streamId === streamId) {
      throw new Error(
        `PTY stream.open failed with ${frame.payload.code}: ${frame.payload.message}`,
      );
    }
  }
}

async function closePtyChannel(input: { socket: WebSocket; streamId: number }): Promise<void> {
  if (input.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  sendJson(input.socket, {
    type: "stream.close",
    streamId: input.streamId,
  });
}

async function runPtyCommand(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  streamId: number;
  command: string;
  timeoutMs: number;
}): Promise<{ exitCode: number; output: string }> {
  const marker = randomUUID().replaceAll("-", "");
  const beginMarker = `__MISTLE_BEGIN_${marker}__`;
  const endMarker = `__MISTLE_END_${marker}__`;
  const commandEnvelope = [
    `printf '%s\\n' ${shellQuote(beginMarker)}`,
    `{ ${input.command}; }`,
    "status=$?",
    `printf '%s:%s\\n' ${shellQuote(endMarker)} "$status"`,
  ].join("; ");
  const outputPattern = new RegExp(
    `(?:^|\\n)${escapeRegex(beginMarker)}\\n([\\s\\S]*?)(?:^|\\n)${escapeRegex(endMarker)}:(\\d+)\\n?`,
    "m",
  );
  const deadlineEpochMs = systemClock.nowMs() + input.timeoutMs;

  sendPtyInput({
    socket: input.socket,
    streamId: input.streamId,
    payload: `${commandEnvelope}\n`,
  });

  let aggregatedOutput = "";
  while (systemClock.nowMs() < deadlineEpochMs) {
    const frame = await waitForNextPtyFrame(
      input.pump,
      Math.max(0, deadlineEpochMs - systemClock.nowMs()),
    );
    if (frame.kind === "control") {
      if (
        frame.payload.type === "stream.event" &&
        frame.payload.streamId === input.streamId &&
        frame.payload.event.type === "pty.exit"
      ) {
        throw new Error(
          `PTY exited unexpectedly with code ${String(frame.payload.event.exitCode)}.`,
        );
      }
      if (frame.payload.type === "stream.reset" && frame.payload.streamId === input.streamId) {
        throw new Error(
          `PTY stream reset unexpectedly with ${frame.payload.code}: ${frame.payload.message}`,
        );
      }
      continue;
    }

    if (frame.kind === "error") {
      throw frame.error;
    }

    aggregatedOutput += frame.text;
    const normalizedOutput = stripTerminalControlSequences(aggregatedOutput).replaceAll("\r", "");
    const match = normalizedOutput.match(outputPattern);
    if (match === null) {
      continue;
    }

    const capturedOutput = match[1] ?? "";
    const rawExitCode = match[2];
    if (rawExitCode === undefined) {
      throw new Error("Expected PTY command output to include an exit code marker.");
    }

    const exitCode = Number.parseInt(rawExitCode, 10);
    if (!Number.isInteger(exitCode)) {
      throw new Error(`Invalid PTY command exit code '${rawExitCode}'.`);
    }

    return {
      exitCode,
      output: capturedOutput.trim(),
    };
  }

  throw new Error(`Timed out after ${String(input.timeoutMs)}ms waiting for PTY command output.`);
}

async function waitForCondition<T>(input: {
  description: string;
  timeoutMs: number;
  evaluate: () => Promise<T | null>;
}): Promise<T> {
  const deadlineMs = systemClock.nowMs() + input.timeoutMs;
  let lastRetryableError: Error | null = null;

  while (systemClock.nowMs() < deadlineMs) {
    try {
      const result = await input.evaluate();
      if (result !== null) {
        return result;
      }
      lastRetryableError = null;
    } catch (error) {
      if (!(error instanceof RetryableWaitError)) {
        throw error;
      }
      lastRetryableError = error;
    }

    await systemSleeper.sleep(SandboxStatusPollIntervalMs);
  }

  if (lastRetryableError !== null) {
    throw new Error(
      `Timed out waiting for ${input.description}. Last retryable error: ${lastRetryableError.message}`,
    );
  }

  throw new Error(`Timed out waiting for ${input.description}.`);
}

async function runDockerLifecycleCommand(input: {
  action: "restart" | "start" | "stop";
  containerId: string;
  timeoutSeconds?: number;
}): Promise<void> {
  const args =
    input.action === "restart" && input.timeoutSeconds !== undefined
      ? [input.action, "-t", String(input.timeoutSeconds), input.containerId]
      : [input.action, input.containerId];
  await execFileAsync("docker", args, {
    cwd: PROJECT_ROOT_HOST_PATH,
  });
}

async function removeSandboxContainersOnNetwork(input: { networkName: string }): Promise<void> {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      "label=mistle.sandbox.provider=docker",
      "--filter",
      `network=${input.networkName}`,
    ],
    {
      cwd: PROJECT_ROOT_HOST_PATH,
    },
  );

  const containerIds = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (containerIds.length === 0) {
    return;
  }

  await execFileAsync("docker", ["rm", "--force", ...containerIds], {
    cwd: PROJECT_ROOT_HOST_PATH,
  });
}

function readOptionalEnvVar(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function resolveE2BConnectionOptions(): ConnectionOpts {
  const apiKey =
    readOptionalEnvVar("MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_API_KEY") ??
    readOptionalEnvVar("MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_API_KEY") ??
    readOptionalEnvVar("E2B_API_KEY");
  if (apiKey === undefined) {
    throw new Error(
      "E2B_API_KEY or a provider-specific Mistle E2B API key env var is required to clean up E2B-backed system test sandboxes.",
    );
  }

  const domain =
    readOptionalEnvVar("MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_E2B_DOMAIN") ??
    readOptionalEnvVar("MISTLE_APPS_DATA_PLANE_API_SANDBOX_E2B_DOMAIN");

  return {
    apiKey,
    ...(domain === undefined ? {} : { domain }),
  };
}

async function listProviderSandboxIds(input: {
  dataPlaneDb: DataPlaneDatabase;
}): Promise<Set<string>> {
  const sandboxInstances = await input.dataPlaneDb.query.sandboxInstances.findMany({
    columns: {
      providerSandboxId: true,
    },
  });
  return new Set(
    sandboxInstances
      .map((sandboxInstance) => sandboxInstance.providerSandboxId)
      .filter((providerSandboxId): providerSandboxId is string => providerSandboxId !== null),
  );
}

async function destroyE2BProviderSandboxesCreatedByTest(input: {
  dataPlaneDb: DataPlaneDatabase;
  baselineProviderSandboxIds: ReadonlySet<string>;
}): Promise<void> {
  const currentProviderSandboxIds = await listProviderSandboxIds({
    dataPlaneDb: input.dataPlaneDb,
  });
  const providerSandboxIds = [...currentProviderSandboxIds].filter(
    (providerSandboxId) => !input.baselineProviderSandboxIds.has(providerSandboxId),
  );
  if (providerSandboxIds.length === 0) {
    return;
  }

  const connectionOptions = resolveE2BConnectionOptions();
  await Promise.all(
    providerSandboxIds.map(async (providerSandboxId) => {
      await Sandbox.kill(providerSandboxId, connectionOptions);
    }),
  );
}

async function readContainerLogsTail(input: {
  containerId: string;
  tail: number;
}): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["logs", "--tail", String(input.tail), input.containerId],
      {
        cwd: PROJECT_ROOT_HOST_PATH,
      },
    );
    const combined = `${stdout}${stderr}`.trim();
    return combined.length > 0 ? combined : "<no logs>";
  } catch (error) {
    return `<failed to read container logs: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

async function resolveContainerHostBaseUrl(input: {
  containerId: string;
  containerPort: number;
  currentBaseUrl: string;
}): Promise<string> {
  const { stdout } = await execFileAsync(
    "docker",
    ["port", input.containerId, String(input.containerPort)],
    {
      cwd: PROJECT_ROOT_HOST_PATH,
    },
  );

  const mappingLine = stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (mappingLine === undefined) {
    throw new Error(
      `Expected docker port output for container '${input.containerId}' port ${String(input.containerPort)}.`,
    );
  }

  const lastColonIndex = mappingLine.lastIndexOf(":");
  if (lastColonIndex < 0 || lastColonIndex === mappingLine.length - 1) {
    throw new Error(`Unexpected docker port output '${mappingLine}'.`);
  }

  const mappedPort = mappingLine.slice(lastColonIndex + 1);
  const baseUrl = new URL(input.currentBaseUrl);
  baseUrl.port = mappedPort;
  return baseUrl.toString().replace(/\/$/, "");
}

async function readSandboxContainerDiagnostics(input: { networkName: string }): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        "--filter",
        "label=mistle.sandbox.provider=docker",
        "--filter",
        `network=${input.networkName}`,
        "--format",
        "{{.ID}} {{.Names}}",
      ],
      {
        cwd: PROJECT_ROOT_HOST_PATH,
      },
    );
    const containerLines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (containerLines.length === 0) {
      return "<no sandbox containers found>";
    }

    const sections: string[] = [];
    for (const line of containerLines) {
      const [containerId, ...nameParts] = line.split(" ");
      if (containerId === undefined || containerId.length === 0) {
        continue;
      }
      const name = nameParts.join(" ").trim();
      const logs = await readContainerLogsTail({
        containerId,
        tail: 120,
      });
      sections.push(
        [`container=${containerId}${name.length > 0 ? ` name=${name}` : ""}`, logs].join("\n"),
      );
    }

    return sections.join("\n\n---\n\n");
  } catch (error) {
    return `<failed to inspect sandbox containers: ${
      error instanceof Error ? error.message : String(error)
    }>`;
  }
}

export const it = vitestIt.extend<{ fixture: SystemTestFixture }>({
  fixture: [
    async ({}, use) => {
      const systemTestContext = await readSystemTestContext();
      const controlPlaneApiBaseUrl = systemTestContext.controlPlaneApiBaseUrl;
      const controlPlaneApiClient = createControlPlaneApiClient(controlPlaneApiBaseUrl);
      const request = createRequestFn(controlPlaneApiBaseUrl);
      let currentDataPlaneGatewayBaseUrl = systemTestContext.dataPlaneGatewayBaseUrl;
      if (systemTestContext.sandboxProvider === "docker") {
        currentDataPlaneGatewayBaseUrl = await resolveContainerHostBaseUrl({
          containerId: systemTestContext.dataPlaneGatewayContainerId,
          containerPort: 5202,
          currentBaseUrl: currentDataPlaneGatewayBaseUrl,
        });
      }
      const databasePool = new Pool({
        connectionString: systemTestContext.controlPlaneDatabaseUrl,
      });
      const db = createControlPlaneDatabase(databasePool);
      const dataPlaneDb = createDataPlaneDatabase(databasePool);
      const baselineProviderSandboxIds =
        systemTestContext.sandboxProvider === "e2b"
          ? await listProviderSandboxIds({
              dataPlaneDb,
            })
          : new Set<string>();
      const mailpitInbox = createMailpitInbox({
        httpBaseUrl: systemTestContext.mailpitHttpBaseUrl,
      });
      const sendSignInOtp = async (input: { email: string }): Promise<Response> => {
        return request("/v1/auth/email-otp/send-verification-otp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: AUTH_ORIGIN,
          },
          body: JSON.stringify({
            email: input.email,
            type: "sign-in",
          }),
        });
      };
      const waitForSignInOtp = async (input: { email: string }): Promise<string> => {
        const listItem = await mailpitInbox.waitForMessage({
          timeoutMs: 15_000,
          description: `OTP email for ${input.email}`,
          matcher: ({ message }) =>
            message.Subject === "Your sign-in code" &&
            message.To.some((address) => address.Address === input.email),
        });
        const message = await mailpitInbox.getMessageSummary(listItem.ID);
        const otp = extractOTPCode(message.Text);
        if (otp === undefined) {
          throw new Error("OTP was not found in Mailpit message text.");
        }

        return otp;
      };
      const signInWithOtp = async (input: { email: string; otp: string }): Promise<Response> => {
        return request("/v1/auth/sign-in/email-otp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: AUTH_ORIGIN,
          },
          body: JSON.stringify({
            email: input.email,
            otp: input.otp,
          }),
        });
      };
      const readRequestCookie = (signInResponse: Response): string => {
        const setCookie = signInResponse.headers.get("set-cookie");
        if (typeof setCookie !== "string" || setCookie.length === 0) {
          throw new Error("Expected sign-in response to include set-cookie.");
        }

        return extractRequestCookie(setCookie);
      };
      const createOrganization = async (input: {
        cookie: string;
        name: string;
        slug: string;
      }): Promise<string> => {
        const createOrganizationResponse = await request("/v1/auth/organization/create", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: input.cookie,
            origin: AUTH_ORIGIN,
          },
          body: JSON.stringify({
            name: input.name,
            slug: input.slug,
          }),
        });
        if (createOrganizationResponse.status !== 200) {
          const errorBody = await createOrganizationResponse.text().catch(() => "");
          throw new Error(
            `Expected organization create response status 200, got ${String(createOrganizationResponse.status)}. Response body: ${errorBody}`,
          );
        }

        const createOrganizationPayload: unknown = await createOrganizationResponse
          .json()
          .catch(() => null);
        const organizationId = readOrganizationIdFromPayload(createOrganizationPayload);
        if (organizationId === null) {
          throw new Error("Expected organization create response to include organization id.");
        }

        return organizationId;
      };
      let sandboxControlContext: SandboxControlContext | undefined;
      const authSession = async (input?: { email?: string }): Promise<AuthenticatedSession> => {
        const email = input?.email ?? generateAuthEmail();

        const sendResponse = await sendSignInOtp({
          email,
        });
        if (sendResponse.status !== 200) {
          throw new Error(
            `Expected OTP send response status 200, got ${String(sendResponse.status)}.`,
          );
        }

        const otp = await waitForSignInOtp({
          email,
        });
        const signInResponse = await signInWithOtp({
          email,
          otp,
        });
        if (signInResponse.status !== 200) {
          throw new Error(
            `Expected OTP sign-in response status 200, got ${String(signInResponse.status)}.`,
          );
        }

        const requestCookie = readRequestCookie(signInResponse);

        const user = await db.query.users.findFirst({
          columns: {
            id: true,
          },
          where: (users, { eq }) => eq(users.email, email),
        });
        if (user === undefined) {
          throw new Error("Expected user to be created after OTP sign-in.");
        }

        const session = await db.query.sessions.findFirst({
          columns: {
            activeOrganizationId: true,
          },
          where: (sessions, { eq }) => eq(sessions.userId, user.id),
          orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
        });
        if (session === undefined) {
          throw new Error("Expected session to exist after OTP sign-in.");
        }

        let activeOrganizationId =
          typeof session.activeOrganizationId === "string" &&
          session.activeOrganizationId.length > 0
            ? session.activeOrganizationId
            : null;

        if (activeOrganizationId === null) {
          activeOrganizationId = await createOrganization({
            cookie: requestCookie,
            name: "System Test Organization",
            slug: `system-${randomUUID()}`,
          });
        }

        return {
          cookie: requestCookie,
          organizationId: activeOrganizationId,
          userId: user.id,
        };
      };
      const enableManagedPersistentSandboxes = async (input: { cookie: string }): Promise<void> => {
        await requestJsonOrThrow({
          request,
          path: "/v1/organization/sandbox-storage-settings",
          expectedStatus: 200,
          description: "organization sandbox storage settings update",
          schema: OrganizationSandboxStorageSettingsResponseSchema,
          init: {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              cookie: input.cookie,
            },
            body: JSON.stringify({
              persistentSandboxesEnabled: true,
              storageConfigSource: "managed",
              organizationStorageConfig: null,
            }),
          },
        });
      };
      const ensureSandboxControlContext = async (): Promise<SandboxControlContext> => {
        if (sandboxControlContext !== undefined) {
          return sandboxControlContext;
        }

        const session = await authSession();
        const openAiConnection = await requestJsonOrThrow({
          request,
          path: `/v1/integration/connections/${encodeURIComponent(OpenAiTargetKey)}/form`,
          expectedStatus: 201,
          description: "OpenAI form connection creation",
          schema: IntegrationConnectionResponseSchema,
          init: {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: session.cookie,
            },
            body: JSON.stringify({
              displayName: `System Restart OpenAI ${randomUUID()}`,
              methodId: OpenAiConnectionMethodId,
              config: {
                connection_method: OpenAiConnectionMethodId,
              },
              secrets: {
                apiKey: OpenAiApiKey,
              },
            }),
          },
        });
        const sandboxProfile = await requestJsonOrThrow({
          request,
          path: "/v1/sandbox/profiles",
          expectedStatus: 201,
          description: "sandbox profile creation",
          schema: SandboxProfileResponseSchema,
          init: {
            method: "POST",
            headers: {
              "content-type": "application/json",
              cookie: session.cookie,
            },
            body: JSON.stringify({
              displayName: `System Restart Sandbox ${randomUUID()}`,
            }),
          },
        });
        await requestJsonOrThrow({
          request,
          path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxProfile.id)}/versions/1/integration-bindings`,
          expectedStatus: 200,
          description: "sandbox profile integration binding update",
          schema: SandboxBindingsResponseSchema,
          init: {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              cookie: session.cookie,
            },
            body: JSON.stringify({
              bindings: [
                {
                  connectionId: openAiConnection.id,
                  kind: "agent",
                  config: {
                    runtime: {
                      runtimeId: "codex",
                      config: {},
                    },
                    model: {
                      defaultModel: "gpt-5.3-codex",
                      options: {
                        reasoningEffort: "medium",
                      },
                    },
                  },
                },
              ],
            }),
          },
        });

        sandboxControlContext = {
          session,
          sandboxProfileId: sandboxProfile.id,
        };
        return sandboxControlContext;
      };
      const waitForSandboxStatus = async (
        sandboxInstanceId: string,
        status: SystemSandboxInstanceStatus["status"],
      ): Promise<SystemSandboxInstanceStatus> => {
        const sandboxContext = await ensureSandboxControlContext();

        return waitForCondition({
          description: `sandbox '${sandboxInstanceId}' to reach status '${status}'`,
          timeoutMs: SandboxReadyTimeoutMs,
          evaluate: async () => {
            const response = await request(
              `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}`,
              {
                headers: {
                  cookie: sandboxContext.session.cookie,
                },
              },
            );
            const bodyText = await response.text().catch(() => "");
            if (response.status !== 200) {
              throw new RetryableWaitError(
                `sandbox status lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
              );
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(bodyText);
            } catch (error) {
              throw new Error(
                `sandbox status lookup returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
              );
            }

            const sandboxStatus = SandboxInstanceStatusResponseSchema.parse(parsed);
            if (sandboxStatus.status === "failed" && status !== "failed") {
              throw new Error(
                `Sandbox '${sandboxStatus.id}' entered terminal status 'failed': ${sandboxStatus.failureMessage ?? "no failure message"}`,
              );
            }

            return sandboxStatus.status === status ? sandboxStatus : null;
          },
        });
      };
      const waitForSandboxConnectable = async (
        sandboxInstanceId: string,
        connectable: boolean,
      ): Promise<SystemSandboxInstanceStatus> => {
        const sandboxContext = await ensureSandboxControlContext();

        return waitForCondition({
          description: `sandbox '${sandboxInstanceId}' connectable=${String(connectable)}`,
          timeoutMs: SandboxReadyTimeoutMs,
          evaluate: async () => {
            const response = await request(
              `/v1/sandbox/instances/${encodeURIComponent(sandboxInstanceId)}`,
              {
                headers: {
                  cookie: sandboxContext.session.cookie,
                },
              },
            );
            const bodyText = await response.text().catch(() => "");
            if (response.status !== 200) {
              throw new RetryableWaitError(
                `sandbox connectable lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
              );
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(bodyText);
            } catch (error) {
              throw new Error(
                `sandbox connectable lookup returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
              );
            }

            const sandboxStatus = SandboxInstanceStatusResponseSchema.parse(parsed);
            if (sandboxStatus.status === "failed") {
              throw new Error(
                `Sandbox '${sandboxStatus.id}' entered terminal status 'failed': ${sandboxStatus.failureMessage ?? "no failure message"}`,
              );
            }

            return sandboxStatus.connectable === connectable ? sandboxStatus : null;
          },
        });
      };
      const startSandboxAndWaitReady = async (): Promise<string> => {
        const sandboxContext = await ensureSandboxControlContext();
        const startedInstance = await requestJsonOrThrow({
          request,
          path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxContext.sandboxProfileId)}/versions/1/instances`,
          expectedStatus: 201,
          description: "sandbox instance start",
          schema: StartSandboxInstanceResponseSchema,
          init: {
            method: "POST",
            headers: {
              cookie: sandboxContext.session.cookie,
            },
          },
        });
        try {
          await waitForSandboxStatus(startedInstance.sandboxInstanceId, "running");
          await waitForSandboxConnectable(startedInstance.sandboxInstanceId, true);
          await waitForSandboxRuntimeAttachment(startedInstance.sandboxInstanceId, true);
          await waitForSandboxRuntimeReady(startedInstance.sandboxInstanceId, true);
        } catch (error) {
          const runtimeState = await readSandboxRuntimeState(
            startedInstance.sandboxInstanceId,
          ).catch(
            (readError: unknown) =>
              `runtime-state read failed: ${
                readError instanceof Error ? readError.message : String(readError)
              }`,
          );
          const sandboxDiagnostics = await readSandboxContainerDiagnostics({
            networkName: systemTestContext.sandboxNetworkName,
          });
          const gatewayLogs = await readContainerLogsTail({
            containerId: systemTestContext.dataPlaneGatewayContainerId,
            tail: 160,
          });
          const dataPlaneApiLogs = await readContainerLogsTail({
            containerId: systemTestContext.dataPlaneApiContainerId,
            tail: 160,
          });
          const dataPlaneWorkerLogs = await readContainerLogsTail({
            containerId: systemTestContext.dataPlaneWorkerContainerId,
            tail: 160,
          });
          throw new Error(
            `Sandbox startup failed for '${startedInstance.sandboxInstanceId}'. Runtime state: ${typeof runtimeState === "string" ? runtimeState : JSON.stringify(runtimeState)}. Sandbox diagnostics: ${sandboxDiagnostics}. Gateway logs: ${gatewayLogs}. Data-plane API logs: ${dataPlaneApiLogs}. Data-plane worker logs: ${dataPlaneWorkerLogs}. Cause: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return startedInstance.sandboxInstanceId;
      };
      const readSandboxRuntimeState = async (
        sandboxInstanceId: string,
      ): Promise<z.infer<typeof SandboxRuntimeStateSnapshotSchema>> => {
        const response = await fetch(
          `${currentDataPlaneGatewayBaseUrl}/internal/sandbox-instances/${encodeURIComponent(sandboxInstanceId)}/runtime-state`,
          {
            headers: {
              [InternalAuthServiceTokenHeader]: systemTestContext.internalAuthServiceToken,
            },
          },
        );
        const payload = await response.json().catch(() => null);
        if (response.status !== 200) {
          throw new Error(
            `Expected runtime-state read status 200, got ${String(response.status)}. Response body: ${JSON.stringify(payload)}`,
          );
        }

        return SandboxRuntimeStateSnapshotSchema.parse(payload);
      };
      const waitForSandboxRuntimeAttachment = async (
        sandboxInstanceId: string,
        attached: boolean,
      ): Promise<z.infer<typeof SandboxRuntimeStateSnapshotSchema>> => {
        return waitForCondition({
          description: `sandbox '${sandboxInstanceId}' runtime attachment attached=${String(attached)}`,
          timeoutMs: SandboxReadyTimeoutMs,
          evaluate: async () => {
            let snapshot: z.infer<typeof SandboxRuntimeStateSnapshotSchema>;
            try {
              snapshot = await readSandboxRuntimeState(sandboxInstanceId);
            } catch (error) {
              throw new RetryableWaitError(
                `sandbox runtime-state read failed while waiting for attachment=${String(attached)}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
            return (snapshot.attachment !== null) === attached ? snapshot : null;
          },
        });
      };
      const waitForSandboxRuntimeReady = async (
        sandboxInstanceId: string,
        ready: boolean,
      ): Promise<z.infer<typeof SandboxRuntimeStateSnapshotSchema>> => {
        return waitForCondition({
          description: `sandbox '${sandboxInstanceId}' runtime.ready=${String(ready)}`,
          timeoutMs: SandboxReadyTimeoutMs,
          evaluate: async () => {
            let snapshot: z.infer<typeof SandboxRuntimeStateSnapshotSchema>;
            try {
              snapshot = await readSandboxRuntimeState(sandboxInstanceId);
            } catch (error) {
              throw new RetryableWaitError(
                `sandbox runtime-state read failed while waiting for runtime.ready=${String(ready)}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
            return snapshot.runtime.ready === ready ? snapshot : null;
          },
        });
      };
      const stopSandboxInstance = async (input: {
        sandboxInstanceId: string;
        idempotencyKey?: string;
      }): Promise<{ sandboxInstanceId: string; workflowRunId: string }> => {
        const runtimeState = await readSandboxRuntimeState(input.sandboxInstanceId);
        const ownerLeaseId = runtimeState.attachment?.ownerLeaseId;
        if (ownerLeaseId === undefined) {
          throw new Error(
            `Sandbox '${input.sandboxInstanceId}' has no attachment owner lease id; stop requires an attached runtime owner.`,
          );
        }

        const response = await fetch(
          `${systemTestContext.dataPlaneApiBaseUrl}/internal/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/stop`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [InternalAuthServiceTokenHeader]: systemTestContext.internalAuthServiceToken,
            },
            body: JSON.stringify({
              stopReason: "idle",
              expectedOwnerLeaseId: ownerLeaseId,
              idempotencyKey: input.idempotencyKey ?? `system-stop-${randomUUID()}`,
            }),
          },
        );
        const payload = await response.json().catch(() => null);
        if (response.status !== 200) {
          throw new Error(
            `Expected internal sandbox stop status 200, got ${String(response.status)}. Response body: ${JSON.stringify(payload)}`,
          );
        }

        const accepted = StopSandboxInstanceAcceptedResponseSchema.parse(payload);
        return {
          sandboxInstanceId: accepted.sandboxInstanceId,
          workflowRunId: accepted.workflowRunId,
        };
      };
      const resumeSandboxInstance = async (input: {
        sandboxInstanceId: string;
        idempotencyKey?: string;
      }): Promise<{ sandboxInstanceId: string; workflowRunId: string }> => {
        const sandboxContext = await ensureSandboxControlContext();
        const response = await fetch(
          `${systemTestContext.dataPlaneApiBaseUrl}/internal/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/resume`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [InternalAuthServiceTokenHeader]: systemTestContext.internalAuthServiceToken,
            },
            body: JSON.stringify({
              organizationId: sandboxContext.session.organizationId,
              idempotencyKey: input.idempotencyKey ?? `system-resume-${randomUUID()}`,
            }),
          },
        );
        const payload = await response.json().catch(() => null);
        if (response.status !== 200) {
          throw new Error(
            `Expected internal sandbox resume status 200, got ${String(response.status)}. Response body: ${JSON.stringify(payload)}`,
          );
        }

        const accepted = ResumeSandboxInstanceAcceptedResponseSchema.parse(payload);
        return {
          sandboxInstanceId: accepted.sandboxInstanceId,
          workflowRunId: accepted.workflowRunId,
        };
      };
      const runSandboxPtyCommand = async (input: {
        sandboxInstanceId: string;
        command: string;
        cwd?: string;
        timeoutMs?: number;
      }): Promise<{ exitCode: number; output: string }> => {
        const sandboxContext = await ensureSandboxControlContext();
        const commandTimeoutMs = input.timeoutMs ?? PtyCommandDefaultTimeoutMs;

        try {
          try {
            await waitForSandboxRuntimeAttachment(input.sandboxInstanceId, true);
            await waitForSandboxRuntimeReady(input.sandboxInstanceId, true);
          } catch (error) {
            throw new RetryableWaitError(
              `sandbox runtime attachment/readiness wait failed before PTY command: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }

          return await waitForCondition({
            description: `sandbox '${input.sandboxInstanceId}' PTY command '${input.command}'`,
            timeoutMs: SandboxReadyTimeoutMs,
            evaluate: async () => {
              let websocket: WebSocket | undefined;
              let streamId: number | undefined;

              try {
                const connectionToken = await requestJsonOrThrow({
                  request,
                  path: `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/connection-tokens`,
                  expectedStatus: 201,
                  description: "sandbox connection token minting",
                  schema: SandboxInstanceConnectionTokenResponseSchema,
                  init: {
                    method: "POST",
                    headers: {
                      cookie: sandboxContext.session.cookie,
                    },
                  },
                });
                websocket = await connectWebSocket(
                  resolveGatewayTunnelWebSocketUrl({
                    mintedUrl: connectionToken.url,
                    gatewayBaseUrl: currentDataPlaneGatewayBaseUrl,
                  }),
                  WebSocketConnectTimeoutMs,
                );
                const pump = createPtyFramePump(websocket);
                streamId = await connectPtyChannel({
                  socket: websocket,
                  pump,
                  cwd: input.cwd ?? "/root",
                });

                return await runPtyCommand({
                  socket: websocket,
                  pump,
                  streamId,
                  command: input.command,
                  timeoutMs: commandTimeoutMs,
                });
              } catch (error) {
                throw new RetryableWaitError(
                  `sandbox PTY command attempt failed: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                );
              } finally {
                if (websocket !== undefined) {
                  if (streamId !== undefined) {
                    await closePtyChannel({
                      socket: websocket,
                      streamId,
                    }).catch(() => {});
                  }
                  await closeWebSocket(websocket).catch(() => {});
                }
              }
            },
          });
        } catch (error) {
          const runtimeState = await readSandboxRuntimeState(input.sandboxInstanceId).catch(
            (readError: unknown) =>
              `runtime-state read failed: ${
                readError instanceof Error ? readError.message : String(readError)
              }`,
          );
          const sandboxDiagnostics = await readSandboxContainerDiagnostics({
            networkName: systemTestContext.sandboxNetworkName,
          });
          const gatewayLogs = await readContainerLogsTail({
            containerId: systemTestContext.dataPlaneGatewayContainerId,
            tail: 160,
          });
          throw new Error(
            `PTY command failed for sandbox '${input.sandboxInstanceId}'. Runtime state: ${typeof runtimeState === "string" ? runtimeState : JSON.stringify(runtimeState)}. Sandbox diagnostics: ${sandboxDiagnostics}. Gateway logs: ${gatewayLogs}. Cause: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      };
      const openPtyAndAssertRoundTrip = async (sandboxInstanceId: string): Promise<void> => {
        try {
          const marker = `mistle-roundtrip-${randomUUID()}`;
          const result = await runSandboxPtyCommand({
            sandboxInstanceId,
            command: `printf '%s\\n' ${shellQuote(marker)}`,
            timeoutMs: PtyRoundTripTimeoutMs,
          });
          if (result.exitCode !== 0) {
            throw new Error(
              `PTY round-trip command failed with exit code ${String(result.exitCode)}. Output: ${result.output}`,
            );
          }
          if (!result.output.includes(marker)) {
            throw new Error(
              `PTY round-trip output did not include expected marker '${marker}'. Output: ${result.output}`,
            );
          }
        } catch (error) {
          const runtimeState = await readSandboxRuntimeState(sandboxInstanceId).catch(
            (readError: unknown) =>
              `runtime-state read failed: ${
                readError instanceof Error ? readError.message : String(readError)
              }`,
          );
          const sandboxDiagnostics = await readSandboxContainerDiagnostics({
            networkName: systemTestContext.sandboxNetworkName,
          });
          const gatewayLogs = await readContainerLogsTail({
            containerId: systemTestContext.dataPlaneGatewayContainerId,
            tail: 160,
          });
          throw new Error(
            `PTY round-trip failed for sandbox '${sandboxInstanceId}'. Runtime state: ${typeof runtimeState === "string" ? runtimeState : JSON.stringify(runtimeState)}. Sandbox diagnostics: ${sandboxDiagnostics}. Gateway logs: ${gatewayLogs}. Cause: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      };
      try {
        await use({
          sandboxProvider: systemTestContext.sandboxProvider,
          controlPlaneApiBaseUrl: systemTestContext.controlPlaneApiBaseUrl,
          controlPlaneApiContainerId: systemTestContext.controlPlaneApiContainerId,
          controlPlaneWorkerBaseUrl: systemTestContext.controlPlaneWorkerBaseUrl,
          controlPlaneWorkerContainerId: systemTestContext.controlPlaneWorkerContainerId,
          dataPlaneApiBaseUrl: systemTestContext.dataPlaneApiBaseUrl,
          dataPlaneApiContainerId: systemTestContext.dataPlaneApiContainerId,
          dataPlaneWorkerBaseUrl: systemTestContext.dataPlaneWorkerBaseUrl,
          dataPlaneWorkerContainerId: systemTestContext.dataPlaneWorkerContainerId,
          get dataPlaneGatewayBaseUrl(): string {
            return currentDataPlaneGatewayBaseUrl;
          },
          dataPlaneGatewayContainerId: systemTestContext.dataPlaneGatewayContainerId,
          tokenizerProxyBaseUrl: systemTestContext.tokenizerProxyBaseUrl,
          tokenizerProxyContainerId: systemTestContext.tokenizerProxyContainerId,
          controlPlaneDatabaseUrl: systemTestContext.controlPlaneDatabaseUrl,
          internalAuthServiceToken: systemTestContext.internalAuthServiceToken,
          otlpTraceCaptureFilePath: systemTestContext.otlpTraceCaptureFilePath,
          dataPlaneGatewayIdleTimeoutMs: systemTestContext.dataPlaneGatewayIdleTimeoutMs,
          dataPlaneGatewayBootstrapDisconnectGraceMs:
            systemTestContext.dataPlaneGatewayBootstrapDisconnectGraceMs,
          controlPlaneApiClient,
          db,
          request,
          sendSignInOtp,
          waitForSignInOtp,
          signInWithOtp,
          readRequestCookie,
          createOrganization,
          authSession,
          enableManagedPersistentSandboxes,
          startSandboxAndWaitReady,
          runSandboxPtyCommand,
          openPtyAndAssertRoundTrip,
          restartContainer: async (containerId, options) => {
            await runDockerLifecycleCommand({
              action: "restart",
              containerId,
              ...(options?.timeoutSeconds === undefined
                ? {}
                : { timeoutSeconds: options.timeoutSeconds }),
            });
            if (containerId === systemTestContext.dataPlaneGatewayContainerId) {
              currentDataPlaneGatewayBaseUrl = await resolveContainerHostBaseUrl({
                containerId,
                containerPort: 5202,
                currentBaseUrl: currentDataPlaneGatewayBaseUrl,
              });
            }
          },
          stopContainer: async (containerId) => {
            await runDockerLifecycleCommand({
              action: "stop",
              containerId,
            });
          },
          startContainer: async (containerId) => {
            await runDockerLifecycleCommand({
              action: "start",
              containerId,
            });
            if (containerId === systemTestContext.dataPlaneGatewayContainerId) {
              currentDataPlaneGatewayBaseUrl = await resolveContainerHostBaseUrl({
                containerId,
                containerPort: 5202,
                currentBaseUrl: currentDataPlaneGatewayBaseUrl,
              });
            }
          },
          waitForSandboxStatus,
          waitForSandboxConnectable,
          waitForSandboxRuntimeAttachment,
          waitForSandboxRuntimeReady,
          readSandboxRuntimeState,
          stopSandboxInstance,
          resumeSandboxInstance,
        });
      } finally {
        if (systemTestContext.sandboxProvider === "e2b") {
          await destroyE2BProviderSandboxesCreatedByTest({
            dataPlaneDb,
            baselineProviderSandboxIds,
          });
        }
        await removeSandboxContainersOnNetwork({
          networkName: systemTestContext.sandboxNetworkName,
        });
        await databasePool.end();
      }
    },
    {
      scope: "test",
    },
  ],
});
