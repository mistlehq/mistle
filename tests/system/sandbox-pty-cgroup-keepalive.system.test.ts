/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended system test fixture with real cross-service flows.
 */

import { randomUUID } from "node:crypto";

import {
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { systemClock, systemScheduler, systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import WebSocket from "ws";
import { z } from "zod";

import { it } from "./system-test-context.js";

const OPENAI_TARGET_KEY = "openai-default";
const OPENAI_CONNECTION_METHOD_ID = "api-key";
const OPENAI_API_KEY = "sk-system-pty-cgroup-keepalive";
const SYSTEM_TEST_TIMEOUT_MS = 8 * 60_000;
const SANDBOX_READY_TIMEOUT_MS = 3 * 60_000;
const WEBSOCKET_TIMEOUT_MS = 30_000;
const PTY_COMMAND_TIMEOUT_MS = 60_000;
const RUNTIME_STATE_TIMEOUT_MS = 90_000;
const PROCESS_LIFETIME_SECONDS = 45;
const POLL_INTERVAL_MS = 1_000;
const TERMINAL_CONTROL_SEQUENCE_PATTERN = new RegExp(
  String.raw`\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])`,
  "g",
);

const IntegrationConnectionResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const SandboxProfileResponseSchema = z.looseObject({
  id: z.string().min(1),
});

const SandboxBindingsResponseSchema = z.object({
  bindings: z.array(z.unknown()),
});

const SandboxProfileVersionDraftBindingsResponseSchema = z.object({
  integrationBindings: SandboxBindingsResponseSchema,
});

const StartSandboxInstanceResponseSchema = z.looseObject({
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

const SandboxInstancePtySessionResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    ptySessionId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
  userId: string;
};

type PtyFramePump = {
  queue: QueuedPtyFrame[];
  waiters: PendingPtyFrameWaiter[];
};

type PtyFrame =
  | {
      kind: "binary";
      text: string;
    }
  | {
      kind: "control";
      payload: StreamControlMessage;
    };

type QueuedPtyFrame =
  | PtyFrame
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

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTerminalControlSequences(input: string): string {
  return input.replaceAll(TERMINAL_CONTROL_SEQUENCE_PATTERN, "");
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
  const deadlineEpochMs = systemClock.nowMs() + input.timeoutMs;

  while (true) {
    const result = await input.evaluate();
    if (result !== null) {
      return result;
    }

    const remainingMs = deadlineEpochMs - systemClock.nowMs();
    if (remainingMs <= 0) {
      throw new Error(`Timed out waiting for ${input.description}.`);
    }

    await systemSleeper.sleep(Math.min(POLL_INTERVAL_MS, remainingMs));
  }
}

async function createOpenAiConnection(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
}): Promise<string> {
  const connection = await requestJsonOrThrow({
    request: input.request,
    path: `/v1/integration/connections/${encodeURIComponent(OPENAI_TARGET_KEY)}/form`,
    expectedStatus: 201,
    description: "OpenAI form connection creation",
    schema: IntegrationConnectionResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: `PTY Keepalive OpenAI ${randomUUID()}`,
        methodId: OPENAI_CONNECTION_METHOD_ID,
        config: {
          connection_method: OPENAI_CONNECTION_METHOD_ID,
        },
        secrets: {
          apiKey: OPENAI_API_KEY,
        },
      }),
    },
  });

  return connection.id;
}

async function createSandboxProfile(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
}): Promise<string> {
  const sandboxProfile = await requestJsonOrThrow({
    request: input.request,
    path: "/v1/sandbox/profiles",
    expectedStatus: 201,
    description: "sandbox profile creation",
    schema: SandboxProfileResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: `PTY Keepalive Sandbox ${randomUUID()}`,
      }),
    },
  });

  return sandboxProfile.id;
}

async function updateSandboxBindings(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  sandboxProfileId: string;
  openAiConnectionId: string;
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/draft`,
    expectedStatus: 200,
    description: "sandbox profile integration binding update",
    schema: SandboxProfileVersionDraftBindingsResponseSchema,
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        integrationBindings: {
          bindings: [
            {
              connectionId: input.openAiConnectionId,
              kind: "agent",
              config: {},
            },
          ],
        },
      }),
    },
  });
}

async function startSandboxInstance(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  sandboxProfileId: string;
}): Promise<string> {
  const startedInstance = await requestJsonOrThrow({
    request: input.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/instances`,
    expectedStatus: 201,
    description: "sandbox instance start",
    schema: StartSandboxInstanceResponseSchema,
    init: {
      method: "POST",
      headers: {
        cookie: input.authenticatedSession.cookie,
      },
    },
  });

  return startedInstance.sandboxInstanceId;
}

async function waitForSandboxReady(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  readSandboxRuntimeState: (sandboxInstanceId: string) => Promise<{
    attachment: object | null;
    runtime: {
      ready: boolean;
    };
  }>;
  sandboxInstanceId: string;
}): Promise<void> {
  await waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' to reach running/connectable`,
    timeoutMs: SANDBOX_READY_TIMEOUT_MS,
    evaluate: async () => {
      const response = await input.request(
        `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}`,
        {
          headers: {
            cookie: input.authenticatedSession.cookie,
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

      const sandboxStatus = SandboxInstanceStatusResponseSchema.parse(parsed);
      if (sandboxStatus.status === "failed" || sandboxStatus.status === "stopped") {
        throw new Error(
          `Sandbox '${sandboxStatus.id}' entered terminal status '${sandboxStatus.status}': ${sandboxStatus.failureMessage ?? "no failure message"}`,
        );
      }

      return sandboxStatus.status === "running" && sandboxStatus.connectable ? sandboxStatus : null;
    },
  });

  await waitForCondition({
    description: `sandbox '${input.sandboxInstanceId}' runtime readiness`,
    timeoutMs: SANDBOX_READY_TIMEOUT_MS,
    evaluate: async () => {
      const snapshot = await input.readSandboxRuntimeState(input.sandboxInstanceId);
      return snapshot.attachment !== null && snapshot.runtime.ready ? snapshot : null;
    },
  });
}

async function mintSandboxConnectionUrl(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  dataPlaneGatewayBaseUrl: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const ptySession = await requestJsonOrThrow({
    request: input.request,
    path: `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}/pty-sessions`,
    expectedStatus: 201,
    description: "sandbox PTY session minting",
    schema: SandboxInstancePtySessionResponseSchema,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.authenticatedSession.cookie,
      },
      body: JSON.stringify({
        ptySessionId: "terminal",
      }),
    },
  });

  const mintedUrl = new URL(ptySession.url);
  const gatewayBaseUrl = new URL(input.dataPlaneGatewayBaseUrl);
  if (gatewayBaseUrl.protocol === "http:") {
    mintedUrl.protocol = "ws:";
  } else if (gatewayBaseUrl.protocol === "https:") {
    mintedUrl.protocol = "wss:";
  } else {
    throw new Error(`Unsupported data plane gateway protocol '${gatewayBaseUrl.protocol}'.`);
  }

  mintedUrl.hostname = gatewayBaseUrl.hostname;
  mintedUrl.port = gatewayBaseUrl.port;

  return mintedUrl.toString();
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

function parseControlMessage(payload: string): StreamControlMessage {
  const parsed = parseStreamControlMessage(payload);
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

        const payload = await websocketDataToUint8Array(event.data);
        enqueue({
          kind: "binary",
          text: Buffer.from(payload).toString("utf8"),
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

  input.socket.send(Buffer.from(new TextEncoder().encode(input.payload)));
}

async function connectPtyChannel(input: { socket: WebSocket; cwd: string }): Promise<number> {
  const streamId = 1;
  sendJson(input.socket, {
    type: "pty.transport.open",
    launch: {
      session: "create",
      cols: 120,
      rows: 40,
      cwd: input.cwd,
    },
  });
  return streamId;
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

async function runSandboxPtyCommand(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  authenticatedSession: AuthenticatedSession;
  dataPlaneGatewayBaseUrl: string;
  sandboxInstanceId: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
}): Promise<{ exitCode: number; output: string }> {
  const connectionUrl = await mintSandboxConnectionUrl({
    request: input.request,
    authenticatedSession: input.authenticatedSession,
    dataPlaneGatewayBaseUrl: input.dataPlaneGatewayBaseUrl,
    sandboxInstanceId: input.sandboxInstanceId,
  });

  const websocket = new WebSocket(connectionUrl);
  try {
    await waitForWebSocketOpen(websocket, WEBSOCKET_TIMEOUT_MS);
    const pump = createPtyFramePump(websocket);
    const streamId = await connectPtyChannel({
      socket: websocket,
      cwd: input.cwd ?? "/root",
    });
    try {
      return await runPtyCommand({
        socket: websocket,
        pump,
        streamId,
        command: input.command,
        timeoutMs: input.timeoutMs ?? PTY_COMMAND_TIMEOUT_MS,
      });
    } finally {
      await closePtyChannel({
        socket: websocket,
        streamId,
      }).catch(() => {});
    }
  } finally {
    await closeWebSocketIfOpen(websocket);
  }
}

async function waitForPtyOutputMatch(input: {
  pump: PtyFramePump;
  streamId: number;
  timeoutMs: number;
  pattern: RegExp;
}): Promise<RegExpMatchArray> {
  const deadlineEpochMs = systemClock.nowMs() + input.timeoutMs;
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
          `PTY exited unexpectedly with code ${String(frame.payload.event.exitCode)} while waiting for output.`,
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
    const match = normalizedOutput.match(input.pattern);
    if (match !== null) {
      return match;
    }
  }

  throw new Error(`Timed out after ${String(input.timeoutMs)}ms waiting for PTY output match.`);
}

describe("sandbox PTY cgroup keepalive", () => {
  it(
    "keeps the sandbox alive for a detached PTY child after the PTY stream closes",
    async ({ fixture }) => {
      let currentStep = "authenticate";
      let websocket: WebSocket | undefined;
      let detachedPid: string | undefined;
      let sandboxInstanceId: string | undefined;
      let detachedProcessCgroupProbe: { exitCode: number; output: string } | undefined;
      let authenticatedSession: Awaited<ReturnType<(typeof fixture)["authSession"]>> | undefined;

      try {
        authenticatedSession = await fixture.authSession({
          email: "sandbox-pty-cgroup-keepalive@example.com",
        });
        const session = authenticatedSession;

        currentStep = "create openai connection";
        const openAiConnectionId = await createOpenAiConnection({
          request: fixture.request,
          authenticatedSession: session,
        });

        currentStep = "create sandbox profile";
        const sandboxProfileId = await createSandboxProfile({
          request: fixture.request,
          authenticatedSession: session,
        });

        currentStep = "bind sandbox runtime";
        await updateSandboxBindings({
          request: fixture.request,
          authenticatedSession: session,
          sandboxProfileId,
          openAiConnectionId,
        });

        currentStep = "start sandbox";
        sandboxInstanceId = await startSandboxInstance({
          request: fixture.request,
          authenticatedSession: session,
          sandboxProfileId,
        });
        const runningSandboxInstanceId = sandboxInstanceId;
        await waitForSandboxReady({
          request: fixture.request,
          authenticatedSession: session,
          readSandboxRuntimeState: fixture.readSandboxRuntimeState,
          sandboxInstanceId: runningSandboxInstanceId,
        });

        const marker = randomUUID();
        const markerDirectory = "/tmp/mistle-system-tests/pty-cgroup-keepalive";
        const pidFilePath = `${markerDirectory}/${marker}.pid`;
        const launchCommand = [
          `mkdir -p ${shellQuote(markerDirectory)}`,
          `rm -f ${shellQuote(pidFilePath)}`,
          `nohup sh -c 'echo $$ > ${pidFilePath}; sleep ${String(PROCESS_LIFETIME_SECONDS)}' >/dev/null 2>&1 < /dev/null & while [ ! -s ${shellQuote(pidFilePath)} ]; do sleep 0.1; done`,
          `printf 'DETACHED_PID:%s\\n' "$(cat ${shellQuote(pidFilePath)})"`,
          "cat",
        ].join("; ");

        currentStep = "open persistent PTY";
        const connectionUrl = await mintSandboxConnectionUrl({
          request: fixture.request,
          authenticatedSession: session,
          dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
          sandboxInstanceId: runningSandboxInstanceId,
        });
        websocket = new WebSocket(connectionUrl);
        await waitForWebSocketOpen(websocket, WEBSOCKET_TIMEOUT_MS);
        const pump = createPtyFramePump(websocket);
        const streamId = await connectPtyChannel({
          socket: websocket,
          cwd: "/root",
        });

        currentStep = "launch detached PTY child";
        sendPtyInput({
          socket: websocket,
          streamId,
          payload: `${launchCommand}\n`,
        });
        const pidMatch = await waitForPtyOutputMatch({
          pump,
          streamId,
          timeoutMs: PTY_COMMAND_TIMEOUT_MS,
          pattern: /DETACHED_PID:(\d+)/,
        });
        detachedPid = pidMatch[1];
        if (detachedPid === undefined) {
          throw new Error("Expected detached PID capture from PTY output.");
        }
        expect(detachedPid).toMatch(/^[0-9]+$/);

        currentStep = "close PTY stream";
        await closePtyChannel({
          socket: websocket,
          streamId,
        });
        await closeWebSocketIfOpen(websocket);
        websocket = undefined;

        currentStep = "assert sandbox remains running and connectable";
        const sandboxStatus = await waitForCondition({
          description: `sandbox '${sandboxInstanceId}' to remain running/connectable`,
          timeoutMs: RUNTIME_STATE_TIMEOUT_MS,
          evaluate: async () => {
            const response = await fixture.request(
              `/v1/sandbox/instances/${encodeURIComponent(runningSandboxInstanceId)}`,
              {
                headers: {
                  cookie: session.cookie,
                },
              },
            );
            const bodyText = await response.text().catch(() => "");
            if (response.status !== 200) {
              throw new Error(
                `sandbox status lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
              );
            }

            const sandboxStatus = SandboxInstanceStatusResponseSchema.parse(JSON.parse(bodyText));
            if (sandboxStatus.status === "failed" || sandboxStatus.status === "stopped") {
              throw new Error(
                `Sandbox '${sandboxStatus.id}' entered terminal status '${sandboxStatus.status}': ${sandboxStatus.failureMessage ?? "no failure message"}`,
              );
            }

            return sandboxStatus.status === "running" && sandboxStatus.connectable
              ? sandboxStatus
              : null;
          },
        });
        expect(sandboxStatus.status).toBe("running");
        expect(sandboxStatus.connectable).toBe(true);

        currentStep = "probe detached process from a fresh PTY session";
        const aliveProbe = await runSandboxPtyCommand({
          request: fixture.request,
          authenticatedSession: session,
          dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
          sandboxInstanceId: runningSandboxInstanceId,
          command: `kill -0 ${detachedPid} >/dev/null 2>&1 && printf '%s\\n' alive`,
        });
        expect(aliveProbe.exitCode).toBe(0);
        expect(aliveProbe.output.trim()).toBe("alive");

        currentStep = "capture detached process cgroup diagnostics";
        detachedProcessCgroupProbe = await runSandboxPtyCommand({
          request: fixture.request,
          authenticatedSession: session,
          dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
          sandboxInstanceId: runningSandboxInstanceId,
          command: [
            "printf 'PROC_CGROUP\\n'",
            `cat /proc/${detachedPid}/cgroup`,
            "printf 'MISTLE_EVENTS\\n'",
            "find /sys/fs/cgroup/mistle -path '*/user/*/cgroup.events' -print -exec cat {} \\; 2>/dev/null",
          ].join("; "),
        });

        currentStep = "wait for runtime keepalive after PTY close";
        const runtimeStateWithDetachedProcess = await waitForCondition({
          description: "detached process keepalive after PTY close",
          timeoutMs: RUNTIME_STATE_TIMEOUT_MS,
          evaluate: async () => {
            const runtimeState = await fixture.readSandboxRuntimeState(runningSandboxInstanceId);
            if (runtimeState.presence.activeCount !== 0) {
              return null;
            }
            return runtimeState.keepalive.active ? runtimeState : null;
          },
        });
        expect(runtimeStateWithDetachedProcess.runtime.ready).toBe(true);
        expect(runtimeStateWithDetachedProcess.presence.activeCount).toBe(0);
        expect(runtimeStateWithDetachedProcess.keepalive.active).toBe(true);

        currentStep = "terminate detached process";
        const terminateResult = await runSandboxPtyCommand({
          request: fixture.request,
          authenticatedSession: session,
          dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
          sandboxInstanceId: runningSandboxInstanceId,
          command: `kill ${detachedPid}`,
        });
        expect(terminateResult.exitCode).toBe(0);

        currentStep = "wait for detached process to disappear";
        await waitForCondition({
          description: `detached process ${detachedPid} to exit`,
          timeoutMs: RUNTIME_STATE_TIMEOUT_MS,
          evaluate: async () => {
            const probe = await runSandboxPtyCommand({
              request: fixture.request,
              authenticatedSession: session,
              dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
              sandboxInstanceId: runningSandboxInstanceId,
              command: `kill -0 ${detachedPid} >/dev/null 2>&1 && printf '%s\\n' alive || printf '%s\\n' dead`,
            });

            return probe.exitCode === 0 && probe.output.trim() === "dead" ? probe : null;
          },
        });

        currentStep = "wait for keepalive to clear after detached process exit";
        const runtimeStateAfterExit = await waitForCondition({
          description: "keepalive to clear after detached process exit",
          timeoutMs: RUNTIME_STATE_TIMEOUT_MS,
          evaluate: async () => {
            const runtimeState = await fixture.readSandboxRuntimeState(runningSandboxInstanceId);
            if (runtimeState.presence.activeCount !== 0) {
              return null;
            }

            return runtimeState.keepalive.active ? null : runtimeState;
          },
        });
        expect(runtimeStateAfterExit.runtime.ready).toBe(true);
        expect(runtimeStateAfterExit.presence.activeCount).toBe(0);
        expect(runtimeStateAfterExit.keepalive.active).toBe(false);
      } catch (error) {
        const diagnostics: string[] = [];
        if (sandboxInstanceId !== undefined) {
          try {
            const runtimeState = await fixture.readSandboxRuntimeState(sandboxInstanceId);
            diagnostics.push(`runtimeState=${JSON.stringify(runtimeState)}`);
          } catch (diagnosticError) {
            diagnostics.push(
              `runtimeStateError=${
                diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
              }`,
            );
          }
        }
        if (
          sandboxInstanceId !== undefined &&
          detachedPid !== undefined &&
          authenticatedSession !== undefined
        ) {
          if (detachedProcessCgroupProbe !== undefined) {
            diagnostics.push(`capturedCgroupProbe=${JSON.stringify(detachedProcessCgroupProbe)}`);
          }
          try {
            const cgroupProbe = await runSandboxPtyCommand({
              request: fixture.request,
              authenticatedSession,
              dataPlaneGatewayBaseUrl: fixture.dataPlaneGatewayBaseUrl,
              sandboxInstanceId,
              command: [
                "printf 'PROC_CGROUP\\n'",
                `cat /proc/${detachedPid}/cgroup`,
                "printf 'MISTLE_EVENTS\\n'",
                "find /sys/fs/cgroup/mistle -path '*/user/*/cgroup.events' -print -exec cat {} \\; 2>/dev/null",
              ].join("; "),
            });
            diagnostics.push(
              `cgroupProbe=${JSON.stringify({
                exitCode: cgroupProbe.exitCode,
                output: cgroupProbe.output,
              })}`,
            );
          } catch (diagnosticError) {
            diagnostics.push(
              `cgroupProbeError=${
                diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
              }`,
            );
          }
        }
        throw new Error(
          `PTY cgroup keepalive test failed during step '${currentStep}': ${
            error instanceof Error ? error.message : String(error)
          }${diagnostics.length === 0 ? "" : ` Diagnostics: ${diagnostics.join(" | ")}`}`,
        );
      } finally {
        await closeWebSocketIfOpen(websocket);
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
