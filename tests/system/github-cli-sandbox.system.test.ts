/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { randomUUID } from "node:crypto";

import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import { it } from "./system-test-context.js";

const GitHubTargetKey = "github-cloud";
const TestTimeoutMs = 10 * 60_000;
const PollIntervalMs = 2_000;
const SandboxReadyTimeoutMs = 3 * 60_000;
const ResourceSyncTimeoutMs = 2 * 60_000;
const WebSocketConnectTimeoutMs = 30_000;
const WebSocketMessageTimeoutMs = 30_000;
const PtyCommandTimeoutMs = 60_000;
const TerminalControlSequencePattern = new RegExp(
  String.raw`\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])`,
  "g",
);

const RequiredEnvNames = [
  "MISTLE_TEST_GITHUB_TEST_REPOSITORY",
  "MISTLE_TEST_GITHUB_INSTALLATION_ID",
] as const;

const StartOAuthConnectionResponseSchema = z
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

const SandboxProfileResponseSchema = z.looseObject({
  id: z.string().min(1),
});

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
  })
  .strict();

const SandboxInstanceConnectionTokenResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.string().min(1),
  })
  .strict();

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

const PTYCloseOKSchema = z
  .object({
    type: z.literal("pty.close.ok"),
    requestId: z.string().min(1),
    exitCode: z.number().int(),
  })
  .strict();

const PTYCloseErrorSchema = z
  .object({
    type: z.literal("pty.close.error"),
    requestId: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

const PTYExitSchema = z
  .object({
    type: z.literal("pty.exit"),
    exitCode: z.number().int(),
  })
  .strict();

type JsonControlMessage =
  | z.infer<typeof ConnectOKSchema>
  | z.infer<typeof ConnectErrorSchema>
  | z.infer<typeof PTYCloseOKSchema>
  | z.infer<typeof PTYCloseErrorSchema>
  | z.infer<typeof PTYExitSchema>;

type PtyFrame =
  | {
      kind: "binary";
      text: string;
    }
  | {
      kind: "control";
      payload: JsonControlMessage;
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

function hasRequiredEnv(): boolean {
  return RequiredEnvNames.every((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });
}

function requireEnv(name: (typeof RequiredEnvNames)[number]): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseGitHubRepository(input: string): { owner: string; repo: string } {
  const [owner, repo, ...rest] = input.split("/");
  if (
    owner === undefined ||
    owner.length === 0 ||
    repo === undefined ||
    repo.length === 0 ||
    rest.length > 0
  ) {
    throw new Error(
      `MISTLE_TEST_GITHUB_TEST_REPOSITORY must be 'owner/repo'. Received '${input}'.`,
    );
  }

  return {
    owner,
    repo,
  };
}

function createOAuthCompletePath(input: {
  targetKey: string;
  query: Record<string, string>;
}): string {
  const searchParams = new URLSearchParams(input.query);
  return `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth/complete?${searchParams.toString()}`;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

function stripTerminalControlSequences(input: string): string {
  return input.replaceAll(TerminalControlSequencePattern, "");
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

function resolveGatewayWebSocketUrl(input: { mintedUrl: string; gatewayBaseUrl: string }): string {
  const mintedUrl = new URL(input.mintedUrl);
  const gatewayBaseUrl = new URL(input.gatewayBaseUrl);

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

    const onClose = (): void => {
      cleanup();
      reject(new Error("Websocket connection closed before open."));
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

function parseControlMessage(value: unknown): JsonControlMessage {
  const parsedConnectOk = ConnectOKSchema.safeParse(value);
  if (parsedConnectOk.success) {
    return parsedConnectOk.data;
  }

  const parsedConnectError = ConnectErrorSchema.safeParse(value);
  if (parsedConnectError.success) {
    return parsedConnectError.data;
  }

  const parsedPtyCloseOk = PTYCloseOKSchema.safeParse(value);
  if (parsedPtyCloseOk.success) {
    return parsedPtyCloseOk.data;
  }

  const parsedPtyCloseError = PTYCloseErrorSchema.safeParse(value);
  if (parsedPtyCloseError.success) {
    return parsedPtyCloseError.data;
  }

  const parsedPtyExit = PTYExitSchema.safeParse(value);
  if (parsedPtyExit.success) {
    return parsedPtyExit.data;
  }

  throw new Error(`Unexpected websocket control message: ${JSON.stringify(value)}`);
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
          const parsed: unknown = JSON.parse(event.data);
          enqueue({
            kind: "control",
            payload: parseControlMessage(parsed),
          });
          return;
        }

        enqueue({
          kind: "binary",
          text: await websocketDataToUtf8(event.data),
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

function sendPtyInput(socket: WebSocket, input: string): void {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error(`Websocket is not open. Current readyState: ${String(socket.readyState)}.`);
  }

  socket.send(Buffer.from(input, "utf8"));
}

async function connectPtyChannel(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  cwd: string;
}): Promise<void> {
  const requestId = `pty-connect-${randomUUID()}`;
  sendJson(input.socket, {
    type: "connect",
    v: 1,
    requestId,
    channel: {
      kind: "pty",
      session: "create",
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
    if (frame.payload.type === "connect.ok" && frame.payload.requestId === requestId) {
      return;
    }
    if (frame.payload.type === "connect.error" && frame.payload.requestId === requestId) {
      throw new Error(`PTY connect failed with ${frame.payload.code}: ${frame.payload.message}`);
    }
  }
}

async function closePtyChannel(input: { socket: WebSocket; pump: PtyFramePump }): Promise<void> {
  if (input.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const requestId = `pty-close-${randomUUID()}`;
  sendJson(input.socket, {
    type: "pty.close",
    requestId,
  });

  while (true) {
    const frame = await waitForNextPtyFrame(input.pump, WebSocketMessageTimeoutMs);
    if (frame.kind !== "control") {
      continue;
    }
    if (frame.payload.type === "pty.close.ok" && frame.payload.requestId === requestId) {
      return;
    }
    if (frame.payload.type === "pty.close.error" && frame.payload.requestId === requestId) {
      throw new Error(`PTY close failed with ${frame.payload.code}: ${frame.payload.message}`);
    }
    if (frame.payload.type === "pty.exit") {
      return;
    }
  }
}

async function runPtyCommand(input: {
  socket: WebSocket;
  pump: PtyFramePump;
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

  sendPtyInput(input.socket, `${commandEnvelope}\n`);

  let aggregatedOutput = "";
  while (Date.now() < deadlineEpochMs) {
    const frame = await waitForNextPtyFrame(input.pump, Math.max(0, deadlineEpochMs - Date.now()));
    if (frame.kind === "control") {
      if (frame.payload.type === "pty.exit") {
        throw new Error(`PTY exited unexpectedly with code ${String(frame.payload.exitCode)}.`);
      }
      continue;
    }

    aggregatedOutput += frame.text.replaceAll("\r", "");
    const match = aggregatedOutput.match(outputPattern);
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
      output: stripTerminalControlSequences(capturedOutput).trim(),
    };
  }

  throw new Error(`Timed out after ${String(input.timeoutMs)}ms waiting for PTY command output.`);
}

async function expectSuccessfulPtyCommand(input: {
  socket: WebSocket;
  pump: PtyFramePump;
  command: string;
  timeoutMs?: number;
  description: string;
}): Promise<string> {
  const result = await runPtyCommand({
    socket: input.socket,
    pump: input.pump,
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

async function waitForSandboxInstanceRunning(input: {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  cookie: string;
  sandboxInstanceId: string;
  timeoutMs: number;
}): Promise<void> {
  await waitForCondition({
    description: "sandbox instance to reach running state",
    timeoutMs: input.timeoutMs,
    evaluate: async () => {
      const response = await input.request(
        `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}`,
        {
          headers: {
            cookie: input.cookie,
          },
        },
      );

      const bodyText = await response.text().catch(() => "");
      if (response.status !== 200) {
        throw new Error(
          `sandbox instance status lookup failed with status ${String(response.status)}. Response body: ${bodyText}`,
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch (error) {
        throw new Error(
          `sandbox instance status lookup returned invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const status = SandboxInstanceStatusResponseSchema.parse(parsed);
      if (status.status === "failed" || status.status === "stopped") {
        throw new Error(
          `Sandbox instance '${status.id}' entered terminal status '${status.status}': ${status.failureMessage ?? "no failure message"}`,
        );
      }

      return status.status === "running" ? status : null;
    },
  });
}

const describeIf = hasRequiredEnv() ? describe : describe.skip;

describeIf("system github cli sandbox", () => {
  it(
    "runs gh and git against a bound GitHub repository from a real sandbox PTY session",
    async ({ fixture }) => {
      const repository = parseGitHubRepository(requireEnv("MISTLE_TEST_GITHUB_TEST_REPOSITORY"));
      const githubInstallationId = requireEnv("MISTLE_TEST_GITHUB_INSTALLATION_ID");
      const dataPlaneGatewayBaseUrl = fixture.dataPlaneGatewayBaseUrl;
      const session = await fixture.authSession();

      const githubOauthStart = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(GitHubTargetKey)}/oauth/start`,
        expectedStatus: 200,
        description: "GitHub OAuth connection start",
        schema: StartOAuthConnectionResponseSchema,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            displayName: `GitHub CLI System Test ${randomUUID()}`,
          }),
        },
      });
      const githubOauthState = new URL(githubOauthStart.authorizationUrl).searchParams.get("state");
      if (githubOauthState === null || githubOauthState.length === 0) {
        throw new Error("Expected GitHub OAuth start response to include a non-empty state.");
      }
      const githubOAuthCompleteResponse = await fixture.request(
        createOAuthCompletePath({
          targetKey: GitHubTargetKey,
          query: {
            state: githubOauthState,
            installation_id: githubInstallationId,
            setup_action: "install",
          },
        }),
        {
          method: "GET",
          headers: {
            cookie: session.cookie,
          },
          redirect: "manual",
        },
      );
      if (githubOAuthCompleteResponse.status !== 302) {
        const errorBody = await githubOAuthCompleteResponse.text().catch(() => "");
        throw new Error(
          `GitHub OAuth connection completion expected status 302, got ${String(githubOAuthCompleteResponse.status)}. Response body: ${errorBody}`,
        );
      }
      const githubConnection = await waitForCondition({
        description: "persisted GitHub connection to be created",
        timeoutMs: ResourceSyncTimeoutMs,
        evaluate: async () => {
          return (
            (await fixture.db.query.integrationConnections.findFirst({
              where: (table, { and, eq }) =>
                and(
                  eq(table.organizationId, session.organizationId),
                  eq(table.targetKey, GitHubTargetKey),
                  eq(table.externalSubjectId, githubInstallationId),
                ),
            })) ?? null
          );
        },
      });
      await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/integration/connections/${encodeURIComponent(githubConnection.id)}/resources/repository/refresh`,
        expectedStatus: 202,
        description: "GitHub repository resource refresh",
        schema: RefreshIntegrationConnectionResourcesResponseSchema,
        init: {
          method: "POST",
          headers: {
            cookie: session.cookie,
          },
        },
      });
      await waitForCondition({
        description: "GitHub repository resource sync to reach ready",
        timeoutMs: ResourceSyncTimeoutMs,
        evaluate: async () => {
          const resourceState =
            await fixture.db.query.integrationConnectionResourceStates.findFirst({
              where: (table, { and, eq }) =>
                and(eq(table.connectionId, githubConnection.id), eq(table.kind, "repository")),
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
                eq(table.connectionId, githubConnection.id),
                eq(table.kind, "repository"),
                eq(table.handle, `${repository.owner}/${repository.repo}`),
              ),
          });

          return resource === undefined ? null : resource;
        },
      });
      const sandboxProfile = await requestJsonOrThrow({
        request: fixture.request,
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
            displayName: `GitHub CLI Sandbox ${randomUUID()}`,
          }),
        },
      });
      await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxProfile.id)}/versions/1/integration-bindings`,
        expectedStatus: 200,
        description: "sandbox profile integration binding update",
        schema: z.object({
          bindings: z.array(z.unknown()),
        }),
        init: {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify({
            bindings: [
              {
                connectionId: githubConnection.id,
                kind: "git",
                config: {
                  repositories: [`${repository.owner}/${repository.repo}`],
                },
              },
            ],
          }),
        },
      });
      const startInstance = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/sandbox/profiles/${encodeURIComponent(sandboxProfile.id)}/versions/1/instances`,
        expectedStatus: 201,
        description: "sandbox profile start instance",
        schema: StartSandboxInstanceResponseSchema,
        init: {
          method: "POST",
          headers: {
            cookie: session.cookie,
          },
        },
      });
      await waitForSandboxInstanceRunning({
        request: fixture.request,
        cookie: session.cookie,
        sandboxInstanceId: startInstance.sandboxInstanceId,
        timeoutMs: SandboxReadyTimeoutMs,
      });
      const connectionToken = await requestJsonOrThrow({
        request: fixture.request,
        path: `/v1/sandbox/instances/${encodeURIComponent(startInstance.sandboxInstanceId)}/connection-tokens`,
        expectedStatus: 201,
        description: "sandbox connection token minting",
        schema: SandboxInstanceConnectionTokenResponseSchema,
        init: {
          method: "POST",
          headers: {
            cookie: session.cookie,
          },
        },
      });
      const websocket = await connectWebSocket(
        resolveGatewayWebSocketUrl({
          mintedUrl: connectionToken.url,
          gatewayBaseUrl: dataPlaneGatewayBaseUrl,
        }),
        WebSocketConnectTimeoutMs,
      );
      const pump = createPtyFramePump(websocket);

      try {
        await connectPtyChannel({
          socket: websocket,
          pump,
          cwd: "/home/sandbox",
        });

        const ghAvailabilityOutput = await expectSuccessfulPtyCommand({
          socket: websocket,
          pump,
          description: "gh and rg binaries plus GH_TOKEN availability",
          command:
            'command -v gh >/dev/null && command -v rg >/dev/null && test -n "$GH_TOKEN" && printf "GH_READY\\n"',
        });
        expect(ghAvailabilityOutput).toContain("GH_READY");

        const repositoryWorkspacePath = `/home/sandbox/projects/${repository.owner}/${repository.repo}`;
        const canonicalOriginOutput = await expectSuccessfulPtyCommand({
          socket: websocket,
          pump,
          description: "canonical repository origin",
          command: `test -d ${shellQuote(`${repositoryWorkspacePath}/.git`)} && git -C ${shellQuote(repositoryWorkspacePath)} remote get-url origin`,
        });
        expect(canonicalOriginOutput).toBe(
          `https://github.com/${repository.owner}/${repository.repo}.git`,
        );

        const graphQlOutput = await expectSuccessfulPtyCommand({
          socket: websocket,
          pump,
          description: "gh api graphql repository query",
          command: [
            `owner=${shellQuote(repository.owner)}`,
            `repo=${shellQuote(repository.repo)}`,
            `gh api graphql -f owner="$owner" -f name="$repo" -f query='query($owner:String!,$name:String!){repository(owner:$owner,name:$name){nameWithOwner}}' --jq '.data.repository.nameWithOwner'`,
          ].join("; "),
        });
        expect(graphQlOutput).toBe(`${repository.owner}/${repository.repo}`);

        const repoViewOutput = await expectSuccessfulPtyCommand({
          socket: websocket,
          pump,
          description: "gh repo view repository lookup",
          command: `gh repo view ${shellQuote(`${repository.owner}/${repository.repo}`)} --json nameWithOwner --jq '.nameWithOwner'`,
        });
        expect(repoViewOutput).toBe(`${repository.owner}/${repository.repo}`);

        const lsRemoteOutput = await expectSuccessfulPtyCommand({
          socket: websocket,
          pump,
          description: "git ls-remote through authenticated proxy mediation",
          command: `git ls-remote ${shellQuote(`https://github.com/${repository.owner}/${repository.repo}.git`)} HEAD`,
        });
        expect(lsRemoteOutput).toMatch(/^[0-9a-f]{40}\tHEAD$/u);
      } finally {
        await closePtyChannel({
          socket: websocket,
          pump,
        }).catch(() => undefined);
        await closeWebSocket(websocket);
      }
    },
    TestTimeoutMs,
  );
});
