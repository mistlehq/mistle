/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended system test fixture and real cross-service flows.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  decodeDataFrame,
  encodeDataFrame,
  parseBootstrapControlMessage,
  PayloadKindRawBytes,
  type BootstrapControlMessage,
} from "@mistle/sandbox-session-protocol";
import { systemScheduler, systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";

import { it, type AuthenticatedSession, type SystemTestFixture } from "./system-test-context.js";

const HttpFixtureHostPath = fileURLToPath(new URL("./fixtures/http-listener.js", import.meta.url));
const WebSocketFixtureHostPath = fileURLToPath(
  new URL("./fixtures/ws-transport-listener.js", import.meta.url),
);

const TestTimeoutMs = 5 * 60_000;
const PollIntervalMs = 1_000;
const SandboxReadyTimeoutMs = 3 * 60_000;
const BootstrapReadyTimeoutMs = 30_000;
const WebSocketOpenTimeoutMs = 15_000;
const WebSocketMessageTimeoutMs = 15_000;
const HttpListenerPort = 5173;
const WebSocketListenerPort = 5174;
const OpenAiTargetKey = "openai-default";
const OpenAiConnectionMethodId = "api-key";
const OpenAiApiKey = "sk-system-port-access";
const NodeRuntimeCommand = "/usr/local/bin/node";
const PtyCommandTimeoutMs = 60_000;
const ListenerProbeTimeoutMs = 10_000;
const TerminalControlSequencePattern = new RegExp(
  String.raw`\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])`,
  "g",
);

const SandboxProfileResponseSchema = z.object({
  id: z.string().min(1),
});

const StartSandboxInstanceResponseSchema = z.object({
  status: z.literal("accepted"),
  workflowRunId: z.string().min(1),
  sandboxInstanceId: z.string().min(1),
});

const SandboxInstanceStatusResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
  failureCode: z.string().min(1).nullable(),
  failureMessage: z.string().min(1).nullable(),
});

const SandboxInstanceConnectionTokenResponseSchema = z.object({
  instanceId: z.string().min(1),
  url: z.url(),
  token: z.string().min(1),
  expiresAt: z.string().min(1),
});

const PortAccessResponseSchema = z.object({
  host: z.string().min(1),
  bootstrapPath: z.literal("/_mistle/access/bootstrap"),
  token: z.string().min(1),
  expiresAt: z.string().min(1),
});

const IntegrationConnectionResponseSchema = z.object({
  id: z.string().min(1),
});

const SandboxBindingsResponseSchema = z.object({
  bindings: z.array(z.unknown()),
});

type PortAccessBootstrap = z.infer<typeof PortAccessResponseSchema>;
const execFileAsync = promisify(execFile);

type PtyFrame =
  | {
      kind: "binary";
      text: string;
    }
  | {
      kind: "control";
      payload: BootstrapControlMessage;
    };

type QueuedPtyFrame =
  | PtyFrame
  | {
      kind: "error";
      error: Error;
    };

type PendingPtyFrameWaiter = {
  resolve: (value: QueuedPtyFrame) => void;
  reject: (error: Error) => void;
  timeoutSignal: AbortSignal;
  onTimeout: () => void;
};

type PtyFramePump = {
  queue: QueuedPtyFrame[];
  waiters: PendingPtyFrameWaiter[];
};

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTerminalControlSequences(input: string): string {
  return input.replaceAll(TerminalControlSequencePattern, "");
}

function resolvePortAccessWebSocketUrl(input: { gatewayBaseUrl: string; path: string }): string {
  const url = new URL(input.path, input.gatewayBaseUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new Error(`Unsupported gateway protocol '${url.protocol}'.`);
  }

  return url.toString();
}

function extractCookiePair(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected a usable Set-Cookie header.");
  }

  return cookiePair;
}

function readHeaderValue(input: IncomingHttpHeaders, key: string): string | undefined {
  const value = input[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}

async function requestJsonOrThrow<TSchema extends z.ZodType>(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  path: string;
  init: RequestInit;
  expectedStatus: number;
  description: string;
  schema: TSchema;
}): Promise<z.infer<TSchema>> {
  const response = await input.request(input.path, input.init);
  const bodyText = await response.text().catch(() => "");

  if (response.status !== input.expectedStatus) {
    throw new Error(
      `${input.description} expected status ${String(input.expectedStatus)}, got ${String(response.status)}. Response body: ${bodyText}`,
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

    await systemSleeper.sleep(PollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${input.description} after ${String(input.timeoutMs)}ms.`);
}

async function createSandboxProfile(input: {
  fixture: Pick<SystemTestFixture, "request">;
  session: AuthenticatedSession;
  displayName: string;
}): Promise<string> {
  const profile = await requestJsonOrThrow({
    request: input.fixture.request,
    path: "/v1/sandbox/profiles",
    expectedStatus: 201,
    description: "sandbox profile creation",
    schema: SandboxProfileResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
      }),
    },
  });

  return profile.id;
}

async function createOpenAiConnection(input: {
  fixture: Pick<SystemTestFixture, "request">;
  session: AuthenticatedSession;
  displayName: string;
}): Promise<string> {
  const connection = await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/integration/connections/${encodeURIComponent(OpenAiTargetKey)}/form`,
    expectedStatus: 201,
    description: "OpenAI form connection creation",
    schema: IntegrationConnectionResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
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

  return connection.id;
}

async function updateSandboxBindings(input: {
  fixture: Pick<SystemTestFixture, "request">;
  session: AuthenticatedSession;
  sandboxProfileId: string;
  bindings: unknown[];
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/integration-bindings`,
    expectedStatus: 200,
    description: "sandbox profile integration binding update",
    schema: SandboxBindingsResponseSchema,
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        bindings: input.bindings,
      }),
    },
  });
}

async function startSandboxInstance(input: {
  fixture: Pick<SystemTestFixture, "request">;
  session: AuthenticatedSession;
  sandboxProfileId: string;
}): Promise<string> {
  const startedInstance = await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/instances`,
    expectedStatus: 201,
    description: "sandbox instance start",
    schema: StartSandboxInstanceResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.session.cookie,
      },
    },
  });

  return startedInstance.sandboxInstanceId;
}

async function waitForSandboxInstanceRunning(input: {
  fixture: Pick<SystemTestFixture, "request">;
  session: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<void> {
  await waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' to reach running`,
    timeoutMs: SandboxReadyTimeoutMs,
    evaluate: async () => {
      const response = await input.fixture.request(
        `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}`,
        {
          headers: {
            cookie: input.session.cookie,
          },
        },
      );
      const bodyText = await response.text().catch(() => "");

      if (response.status !== 200) {
        throw new Error(
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

      const status = SandboxInstanceStatusResponseSchema.parse(parsed);
      if (status.status === "failed" || status.status === "stopped") {
        throw new Error(
          `Sandbox '${status.id}' entered terminal status '${status.status}': ${status.failureMessage ?? "no failure message"}`,
        );
      }

      return status.status === "running" ? status : null;
    },
  });
}

async function mintConnectionToken(input: {
  fixture: Pick<SystemTestFixture, "request">;
  session: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<z.infer<typeof SandboxInstanceConnectionTokenResponseSchema>> {
  return await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/connection-tokens`,
    expectedStatus: 201,
    description: "sandbox connection token minting",
    schema: SandboxInstanceConnectionTokenResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.session.cookie,
      },
    },
  });
}

async function mintPortAccess(input: {
  fixture: Pick<SystemTestFixture, "request">;
  session: AuthenticatedSession;
  sandboxInstanceId: string;
  port: number;
}): Promise<PortAccessBootstrap> {
  return await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/ports/${String(input.port)}/access`,
    expectedStatus: 201,
    description: "port access bootstrap minting",
    schema: PortAccessResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.session.cookie,
      },
    },
  });
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

  const onMessage = (event: WebSocket.MessageEvent): void => {
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
            `Failed to decode websocket frame: ${error instanceof Error ? error.message : String(error)}`,
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

async function waitForNextPtyFrame(pump: PtyFramePump, timeoutMs: number): Promise<PtyFrame> {
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
    const frame = await waitForNextPtyFrame(input.pump, WebSocketMessageTimeoutMs);
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
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  sendPtyInput({
    socket: input.socket,
    streamId: input.streamId,
    payload: `${commandEnvelope}\n`,
  });

  let aggregatedOutput = "";
  while (Date.now() < deadlineEpochMs) {
    const frame = await waitForNextPtyFrame(input.pump, Math.max(0, deadlineEpochMs - Date.now()));
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

async function expectSuccessfulPtyCommand(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  streamId: number;
  command: string;
  timeoutMs?: number;
  description: string;
}): Promise<string> {
  const result = await runPtyCommand({
    socket: input.socket,
    pump: input.pump,
    streamId: input.streamId,
    command: input.command,
    timeoutMs: input.timeoutMs ?? PtyCommandTimeoutMs,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${input.description} failed with exit code ${String(result.exitCode)}. Output: ${result.output}`,
    );
  }

  return result.output;
}

async function stageFixtureScript(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  streamId: number;
  hostFixturePath: string;
  sandboxFixturePath: string;
}): Promise<void> {
  const contents = await readFile(input.hostFixturePath, "utf8");
  const delimiter = `MISTLE_FIXTURE_${randomUUID().replaceAll("-", "")}`;
  const command = [
    `mkdir -p ${shellQuote("/tmp/mistle-port-access-system")}`,
    `cat > ${shellQuote(input.sandboxFixturePath)} <<'${delimiter}'`,
    contents,
    delimiter,
  ].join("\n");

  await expectSuccessfulPtyCommand({
    socket: input.socket,
    pump: input.pump,
    streamId: input.streamId,
    command: `sh -lc ${shellQuote(command)}`,
    description: `staging sandbox fixture '${input.sandboxFixturePath}'`,
  });
}

async function startFixtureListener(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  streamId: number;
  sandboxFixturePath: string;
  port: number;
  marker: string;
  logPath: string;
}): Promise<void> {
  await expectSuccessfulPtyCommand({
    socket: input.socket,
    pump: input.pump,
    streamId: input.streamId,
    command: [
      "sh -lc",
      shellQuote(
        [
          `${NodeRuntimeCommand} ${shellQuote(input.sandboxFixturePath)} ${String(input.port)} ${shellQuote(input.marker)} > ${shellQuote(input.logPath)} 2>&1 &`,
          "printf 'started\\n'",
        ].join(" "),
      ),
    ].join(" "),
    description: `starting listener '${input.sandboxFixturePath}' on port ${String(input.port)}`,
  });
}

async function waitForListenerReady(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  streamId: number;
  port: number;
  logPath: string;
  description: string;
}): Promise<void> {
  try {
    await waitForCondition({
      description: input.description,
      timeoutMs: BootstrapReadyTimeoutMs,
      evaluate: async () => {
        const result = await runPtyCommand({
          socket: input.socket,
          pump: input.pump,
          streamId: input.streamId,
          command: [
            `${NodeRuntimeCommand} -e`,
            shellQuote(
              [
                'const net = require("node:net");',
                "const socket = net.createConnection({ host: '127.0.0.1', port: " +
                  String(input.port) +
                  " });",
                "socket.setTimeout(1000);",
                "socket.once('connect', () => { socket.end(); process.exit(0); });",
                "socket.once('timeout', () => { socket.destroy(); process.exit(1); });",
                "socket.once('error', () => { process.exit(1); });",
              ].join("; "),
            ),
          ].join(" "),
          timeoutMs: ListenerProbeTimeoutMs,
        });

        return result.exitCode === 0 ? true : null;
      },
    });
  } catch (error) {
    const logOutput = await expectSuccessfulPtyCommand({
      socket: input.socket,
      pump: input.pump,
      streamId: input.streamId,
      command: `sh -lc ${shellQuote(`test -f ${shellQuote(input.logPath)} && cat ${shellQuote(input.logPath)} || printf '<missing log>\\n'`)}`,
      description: `reading listener log '${input.logPath}'`,
      timeoutMs: ListenerProbeTimeoutMs,
    }).catch((logError: unknown) => {
      return `<failed to read log: ${logError instanceof Error ? logError.message : String(logError)}>`;
    });
    const processOutput = await expectSuccessfulPtyCommand({
      socket: input.socket,
      pump: input.pump,
      streamId: input.streamId,
      command:
        "sh -lc " +
        shellQuote(
          [
            "printf '%s\\n' '=== ps ==='",
            "ps -ef",
            "printf '%s\\n' '=== lsof ==='",
            "lsof -nP -iTCP -sTCP:LISTEN || true",
          ].join("; "),
        ),
      description: "reading sandbox process diagnostics",
      timeoutMs: ListenerProbeTimeoutMs,
    }).catch((processError: unknown) => {
      return `<failed to read process diagnostics: ${processError instanceof Error ? processError.message : String(processError)}>`;
    });

    throw new Error(
      `${input.description} failed: ${error instanceof Error ? error.message : String(error)}. Listener log: ${logOutput}. Process diagnostics: ${processOutput}`,
    );
  }
}

async function sendGatewayHttpRequest(input: {
  baseUrl: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
}> {
  const url = new URL(input.path, input.baseUrl);

  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: input.method,
        headers: input.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
        response.on("error", reject);
      },
    );

    request.on("error", reject);
    if (input.body !== undefined) {
      request.write(input.body);
    }
    request.end();
  });
}

async function bootstrapPortAccess(input: {
  fixture: Pick<SystemTestFixture, "dataPlaneGatewayBaseUrl">;
  bootstrap: PortAccessBootstrap;
}): Promise<string> {
  return await waitForCondition({
    description: `port access bootstrap for host '${input.bootstrap.host}'`,
    timeoutMs: BootstrapReadyTimeoutMs,
    evaluate: async () => {
      const response = await sendGatewayHttpRequest({
        baseUrl: input.fixture.dataPlaneGatewayBaseUrl,
        path: `${input.bootstrap.bootstrapPath}?token=${encodeURIComponent(input.bootstrap.token)}`,
        method: "GET",
        headers: {
          host: input.bootstrap.host,
        },
      });

      if (response.status === 409) {
        return null;
      }
      if (response.status !== 302) {
        throw new Error(
          `Expected bootstrap status 302, got ${String(response.status)}. Response body: ${response.body}`,
        );
      }

      const location = readHeaderValue(response.headers, "location");
      if (location !== "/") {
        throw new Error(`Expected bootstrap redirect to '/', got '${location ?? "(missing)"}'.`);
      }
      const setCookie = readHeaderValue(response.headers, "set-cookie");
      if (setCookie === undefined) {
        throw new Error("Expected bootstrap response to include set-cookie.");
      }

      return extractCookiePair(setCookie);
    },
  });
}

async function waitForWebSocketOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = systemScheduler.schedule(() => {
      cleanup();
      reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for websocket open.`));
    }, timeoutMs);

    const onOpen = (): void => {
      cleanup();
      resolve();
    };

    const onError = (): void => {
      cleanup();
      reject(new Error("Websocket emitted an error before open."));
    };

    const onClose = (): void => {
      cleanup();
      reject(new Error("Websocket closed before open."));
    };

    const cleanup = (): void => {
      systemScheduler.cancel(timeout);
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("open", onOpen);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

async function waitForWebSocketTextMessage(socket: WebSocket, timeoutMs: number): Promise<string> {
  return await new Promise((resolve, reject) => {
    const timeout = systemScheduler.schedule(() => {
      cleanup();
      reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for websocket message.`));
    }, timeoutMs);

    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      if (isBinary) {
        reject(new Error("Expected a text websocket message."));
        return;
      }

      const text =
        typeof data === "string"
          ? data
          : data instanceof ArrayBuffer
            ? Buffer.from(data).toString("utf8")
            : Buffer.isBuffer(data)
              ? data.toString("utf8")
              : Buffer.concat(data).toString("utf8");
      resolve(text);
    };

    const onError = (): void => {
      cleanup();
      reject(new Error("Websocket emitted an error while waiting for a message."));
    };

    const onClose = (): void => {
      cleanup();
      reject(new Error("Websocket closed while waiting for a message."));
    };

    const cleanup = (): void => {
      systemScheduler.cancel(timeout);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = systemScheduler.schedule(() => {
      cleanup();
      resolve();
    }, 3_000);

    const onClose = (): void => {
      cleanup();
      resolve();
    };

    const cleanup = (): void => {
      systemScheduler.cancel(timeout);
      socket.off("close", onClose);
    };

    socket.on("close", onClose);
    socket.close();
  });
}

async function readContainerLogs(containerId: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync("docker", [
      "logs",
      "--tail",
      "200",
      containerId,
    ]);
    const combined = `${stdout}${stderr}`.trim();
    return combined.length > 0 ? combined : "<no logs>";
  } catch (error) {
    return `<failed to read container logs: ${error instanceof Error ? error.message : String(error)}>`;
  }
}

describe("system port access", () => {
  it(
    "serves a real HTTP listener through control-plane minting, gateway bootstrap, and sandboxd transport",
    async ({ fixture }) => {
      const session = await fixture.authSession();
      const openAiConnectionId = await createOpenAiConnection({
        fixture,
        session,
        displayName: `Port Access OpenAI ${randomUUID()}`,
      });
      const sandboxProfileId = await createSandboxProfile({
        fixture,
        session,
        displayName: `Port Access HTTP ${randomUUID()}`,
      });
      await updateSandboxBindings({
        fixture,
        session,
        sandboxProfileId,
        bindings: [
          {
            connectionId: openAiConnectionId,
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
      });
      const sandboxInstanceId = await startSandboxInstance({
        fixture,
        session,
        sandboxProfileId,
      });
      await waitForSandboxInstanceRunning({
        fixture,
        session,
        sandboxInstanceId,
      });

      const connectionToken = await mintConnectionToken({
        fixture,
        session,
        sandboxInstanceId,
      });
      const marker = `http-${randomUUID()}`;
      const sandboxFixturePath = "/tmp/mistle-port-access-system/http-listener.js";
      const websocket = new WebSocket(
        resolveGatewayTunnelWebSocketUrl({
          mintedUrl: connectionToken.url,
          gatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
        }),
      );
      let ptyStreamId: number | undefined;

      try {
        await waitForWebSocketOpen(websocket, WebSocketOpenTimeoutMs);
        const pump = createPtyFramePump(websocket);
        ptyStreamId = await connectPtyChannel({
          socket: websocket,
          pump,
          cwd: "/root",
        });
        await stageFixtureScript({
          socket: websocket,
          pump,
          streamId: ptyStreamId,
          hostFixturePath: HttpFixtureHostPath,
          sandboxFixturePath,
        });
        await startFixtureListener({
          socket: websocket,
          pump,
          streamId: ptyStreamId,
          sandboxFixturePath,
          port: HttpListenerPort,
          marker,
          logPath: "/tmp/mistle-port-access-system/http-listener.log",
        });
        await waitForListenerReady({
          socket: websocket,
          pump,
          streamId: ptyStreamId,
          port: HttpListenerPort,
          logPath: "/tmp/mistle-port-access-system/http-listener.log",
          description: "HTTP listener to become reachable inside sandbox",
        });

        const bootstrap = await mintPortAccess({
          fixture,
          session,
          sandboxInstanceId,
          port: HttpListenerPort,
        });
        const sessionCookie = await bootstrapPortAccess({
          fixture,
          bootstrap,
        });

        const response = await sendGatewayHttpRequest({
          baseUrl: fixture.dataPlaneGatewayBaseUrl,
          path: "/",
          method: "GET",
          headers: {
            cookie: sessionCookie,
            host: bootstrap.host,
          },
        });

        if (response.status !== 200) {
          const gatewayLogs = await readContainerLogs(fixture.dataPlaneGatewayContainerId);
          throw new Error(
            `Expected HTTP port access response status 200, got ${String(response.status)}. Headers=${JSON.stringify(response.headers)} Body=${response.body} GatewayLogs=${gatewayLogs}`,
          );
        }
        expect(readHeaderValue(response.headers, "content-type")).toBe("text/plain; charset=utf-8");
        expect(response.body).toBe(marker);
      } finally {
        if (ptyStreamId !== undefined) {
          await closePtyChannel({
            socket: websocket,
            streamId: ptyStreamId,
          });
        }
        await closeWebSocketIfOpen(websocket);
      }
    },
    TestTimeoutMs,
  );

  it(
    "relays a real websocket listener through control-plane minting, gateway bootstrap, and sandboxd transport",
    async ({ fixture }) => {
      const session = await fixture.authSession();
      const openAiConnectionId = await createOpenAiConnection({
        fixture,
        session,
        displayName: `Port Access OpenAI ${randomUUID()}`,
      });
      const sandboxProfileId = await createSandboxProfile({
        fixture,
        session,
        displayName: `Port Access WebSocket ${randomUUID()}`,
      });
      await updateSandboxBindings({
        fixture,
        session,
        sandboxProfileId,
        bindings: [
          {
            connectionId: openAiConnectionId,
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
      });
      const sandboxInstanceId = await startSandboxInstance({
        fixture,
        session,
        sandboxProfileId,
      });
      await waitForSandboxInstanceRunning({
        fixture,
        session,
        sandboxInstanceId,
      });

      const connectionToken = await mintConnectionToken({
        fixture,
        session,
        sandboxInstanceId,
      });
      const marker = `ws-${randomUUID()}`;
      const sandboxFixturePath = "/tmp/mistle-port-access-system/ws-listener.js";
      const tunnelWebSocket = new WebSocket(
        resolveGatewayTunnelWebSocketUrl({
          mintedUrl: connectionToken.url,
          gatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
        }),
      );
      let ptyStreamId: number | undefined;
      let websocket: WebSocket | undefined;

      try {
        await waitForWebSocketOpen(tunnelWebSocket, WebSocketOpenTimeoutMs);
        const pump = createPtyFramePump(tunnelWebSocket);
        ptyStreamId = await connectPtyChannel({
          socket: tunnelWebSocket,
          pump,
          cwd: "/root",
        });
        await stageFixtureScript({
          socket: tunnelWebSocket,
          pump,
          streamId: ptyStreamId,
          hostFixturePath: WebSocketFixtureHostPath,
          sandboxFixturePath,
        });
        await startFixtureListener({
          socket: tunnelWebSocket,
          pump,
          streamId: ptyStreamId,
          sandboxFixturePath,
          port: WebSocketListenerPort,
          marker,
          logPath: "/tmp/mistle-port-access-system/ws-listener.log",
        });
        await waitForListenerReady({
          socket: tunnelWebSocket,
          pump,
          streamId: ptyStreamId,
          port: WebSocketListenerPort,
          logPath: "/tmp/mistle-port-access-system/ws-listener.log",
          description: "websocket listener to become reachable inside sandbox",
        });

        const bootstrap = await mintPortAccess({
          fixture,
          session,
          sandboxInstanceId,
          port: WebSocketListenerPort,
        });
        const sessionCookie = await bootstrapPortAccess({
          fixture,
          bootstrap,
        });

        websocket = new WebSocket(
          resolvePortAccessWebSocketUrl({
            gatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
            path: "/echo",
          }),
          {
            headers: {
              cookie: sessionCookie,
              host: bootstrap.host,
            },
          },
        );
        await waitForWebSocketOpen(websocket, WebSocketOpenTimeoutMs);

        websocket.send(marker);
        await expect(
          waitForWebSocketTextMessage(websocket, WebSocketMessageTimeoutMs),
        ).resolves.toBe(marker);
      } finally {
        await closeWebSocketIfOpen(websocket);
        if (ptyStreamId !== undefined) {
          await closePtyChannel({
            socket: tunnelWebSocket,
            streamId: ptyStreamId,
          });
        }
        await closeWebSocketIfOpen(tunnelWebSocket);
      }
    },
    TestTimeoutMs,
  );
});
