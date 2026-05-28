import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { join, relative } from "node:path";

import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import {
  parseBootstrapControlMessage,
  type BootstrapControlMessage,
} from "@mistle/sandbox-session-protocol";
import { systemScheduler, systemSleeper } from "@mistle/time";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";

import {
  createSandboxProfileRuntimeConfigUpdate,
  type CodexSandboxAuthenticatedSession,
  type CodexSandboxFixture,
  type SystemSandboxProvider,
} from "./codex-sandbox.js";

const OpenAiTargetKey = "openai-default";
const OpenAiConnectionMethodId = "api-key";
const OpenAiApiKey = "sk-system-port-access";
const TestEnvironmentIdHeader = "x-mistle-test-environment-id";

export const SandboxReadyTimeoutMs = 3 * 60_000;
export const BootstrapReadyTimeoutMs = 30_000;
export const WebSocketOpenTimeoutMs = 15_000;
export const WebSocketMessageTimeoutMs = 15_000;
export const ListenerProbeTimeoutMs = 10_000;
export const ExecCommandDefaultTimeoutMs = 60_000;
export const NodeToolCommand = "/usr/local/bin/node";

const PollIntervalMs = 1_000;

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
  status: z.enum(SandboxInstanceStatuses),
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
  url: z.url(),
  expiresAt: z.string().min(1),
});

const IntegrationConnectionResponseSchema = z.object({
  id: z.string().min(1),
});

const SandboxBindingsResponseSchema = z.object({
  bindings: z.array(z.unknown()),
});

const SandboxProfileVersionDraftBindingsResponseSchema = z.object({
  integrationBindings: SandboxBindingsResponseSchema,
});

type PortAccessBootstrap = z.infer<typeof PortAccessResponseSchema>;
type PortAccessRequest = CodexSandboxFixture["request"];
type PortAccessRequestInit = NonNullable<Parameters<PortAccessRequest>[1]>;

type QueuedControlMessage =
  | {
      kind: "message";
      payload: BootstrapControlMessage;
    }
  | {
      kind: "error";
      error: Error;
    };

type PendingControlMessageWaiter = {
  resolve: (value: QueuedControlMessage) => void;
  reject: (error: Error) => void;
  timeoutSignal: AbortSignal;
  onTimeout: () => void;
};

export type ControlMessagePump = {
  queue: QueuedControlMessage[];
  waiters: PendingControlMessageWaiter[];
};

type ExecCommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
  truncated: boolean;
};

type FixtureFile = {
  contents: string;
  sandboxPath: string;
};

function decodeWebSocketText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

function applyBaseUrlQueryParams(input: { baseUrl: URL; url: URL }): URL {
  for (const [key, value] of input.baseUrl.searchParams) {
    if (!input.url.searchParams.has(key)) {
      input.url.searchParams.append(key, value);
    }
  }

  return input.url;
}

function resolveUrlWithoutBaseQuery(input: { baseUrl: string; path: string }): URL {
  const baseUrl = new URL(input.baseUrl);
  baseUrl.search = "";
  return new URL(input.path, baseUrl);
}

export function readGatewayBaseUrlRequestHeaders(baseUrl: string): Record<string, string> {
  const environmentId = new URL(baseUrl).searchParams.get(TestEnvironmentIdHeader);
  if (environmentId === null) {
    return {};
  }

  return {
    [TestEnvironmentIdHeader]: environmentId,
  };
}

function extractCookiePair(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected a usable Set-Cookie header.");
  }

  return cookiePair;
}

function drainControlMessagePump(pump: ControlMessagePump): void {
  while (pump.waiters.length > 0 && pump.queue.length > 0) {
    const waiter = pump.waiters.shift();
    const queued = pump.queue.shift();
    if (waiter === undefined || queued === undefined) {
      return;
    }

    waiter.timeoutSignal.removeEventListener("abort", waiter.onTimeout);
    if (queued.kind === "error") {
      waiter.reject(queued.error);
      continue;
    }

    waiter.resolve(queued);
  }
}

function enqueueControlMessage(pump: ControlMessagePump, queued: QueuedControlMessage): void {
  pump.queue.push(queued);
  drainControlMessagePump(pump);
}

async function requestJsonOrThrow<TSchema extends z.ZodType>(input: {
  request: PortAccessRequest;
  path: string;
  init: PortAccessRequestInit;
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

export function readHeaderValue(input: IncomingHttpHeaders, key: string): string | undefined {
  const value = input[key];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }

  return undefined;
}

export async function waitForCondition<T>(input: {
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

export async function createOpenAiConnection(input: {
  fixture: Pick<CodexSandboxFixture, "request">;
  session: CodexSandboxAuthenticatedSession;
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

export async function createSandboxProfile(input: {
  fixture: Pick<CodexSandboxFixture, "request">;
  session: CodexSandboxAuthenticatedSession;
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

export async function updateSandboxBindings(input: {
  fixture: Pick<CodexSandboxFixture, "request">;
  session: CodexSandboxAuthenticatedSession;
  sandboxProvider: SystemSandboxProvider;
  sandboxProfileId: string;
  bindings: unknown[];
}): Promise<void> {
  await requestJsonOrThrow({
    request: input.fixture.request,
    path: `/v1/sandbox/profiles/${encodeURIComponent(input.sandboxProfileId)}/versions/1/draft`,
    expectedStatus: 200,
    description: "sandbox profile integration binding update",
    schema: SandboxProfileVersionDraftBindingsResponseSchema,
    init: {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        ...createSandboxProfileRuntimeConfigUpdate(input.sandboxProvider),
        integrationBindings: {
          bindings: input.bindings,
        },
      }),
    },
  });
}

export async function startSandboxInstance(input: {
  fixture: Pick<CodexSandboxFixture, "request">;
  session: CodexSandboxAuthenticatedSession;
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

export async function waitForSandboxInstanceRunning(input: {
  fixture: Pick<CodexSandboxFixture, "request">;
  session: CodexSandboxAuthenticatedSession;
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
          `sandbox status lookup failed with status ${String(response.status)} for sandbox '${input.sandboxInstanceId}'. Response body: ${bodyText}`,
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

export async function mintConnectionToken(input: {
  fixture: Pick<CodexSandboxFixture, "request">;
  session: CodexSandboxAuthenticatedSession;
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

export async function mintPortAccess(input: {
  fixture: Pick<CodexSandboxFixture, "request">;
  session: CodexSandboxAuthenticatedSession;
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

export function resolveGatewayTunnelWebSocketUrl(input: {
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

  return applyBaseUrlQueryParams({ baseUrl: gatewayBaseUrl, url: mintedUrl }).toString();
}

export function resolvePortAccessWebSocketUrl(input: {
  gatewayBaseUrl: string;
  path: string;
}): string {
  const url = resolveUrlWithoutBaseQuery({
    baseUrl: input.gatewayBaseUrl,
    path: input.path,
  });
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new Error(`Unsupported gateway protocol '${url.protocol}'.`);
  }

  return url.toString();
}

export function createControlMessagePump(socket: WebSocket): ControlMessagePump {
  const pump: ControlMessagePump = {
    queue: [],
    waiters: [],
  };

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      return;
    }

    const text = decodeWebSocketText(data);
    const payload = parseBootstrapControlMessage(text);
    if (payload === undefined) {
      enqueueControlMessage(pump, {
        kind: "error",
        error: new Error(`Unexpected websocket control message: ${text}`),
      });
      return;
    }

    enqueueControlMessage(pump, {
      kind: "message",
      payload,
    });
  });

  socket.on("error", () => {
    enqueueControlMessage(pump, {
      kind: "error",
      error: new Error("Websocket emitted an error while waiting for control messages."),
    });
  });

  socket.on("close", () => {
    enqueueControlMessage(pump, {
      kind: "error",
      error: new Error("Websocket closed while waiting for control messages."),
    });
  });

  return pump;
}

export async function waitForNextControlMessage(
  pump: ControlMessagePump,
  timeoutMs: number,
): Promise<BootstrapControlMessage> {
  const queued = pump.queue.shift();
  if (queued !== undefined) {
    if (queued.kind === "error") {
      throw queued.error;
    }

    return queued.payload;
  }

  if (timeoutMs <= 0) {
    throw new Error(`Timed out after ${String(timeoutMs)}ms waiting for control message.`);
  }

  const nextMessage = await new Promise<QueuedControlMessage>((resolve, reject) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const waiter: PendingControlMessageWaiter = {
      resolve,
      reject,
      timeoutSignal,
      onTimeout: () => {
        const waiterIndex = pump.waiters.indexOf(waiter);
        if (waiterIndex >= 0) {
          pump.waiters.splice(waiterIndex, 1);
        }
        reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for control message.`));
      },
    };

    pump.waiters.push(waiter);
    timeoutSignal.addEventListener("abort", waiter.onTimeout, { once: true });
  });

  if (nextMessage.kind === "error") {
    throw nextMessage.error;
  }

  return nextMessage.payload;
}

function sendJson(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    throw new Error(`Websocket is not open. Current readyState: ${String(socket.readyState)}.`);
  }

  socket.send(JSON.stringify(payload));
}

export async function runExecCommand(input: {
  socket: WebSocket;
  pump: ControlMessagePump;
  streamId: number;
  command: string;
  args?: readonly string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}): Promise<ExecCommandResult> {
  sendJson(input.socket, {
    type: "stream.open",
    streamId: input.streamId,
    channel: {
      kind: "exec",
      command: input.command,
      ...(input.args === undefined ? {} : { args: [...input.args] }),
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      timeoutMs: input.timeoutMs,
      ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
    },
  });

  let execResult: ExecCommandResult | undefined;
  const deadlineEpochMs = Date.now() + input.timeoutMs;

  while (Date.now() < deadlineEpochMs) {
    const frame = await waitForNextControlMessage(
      input.pump,
      Math.max(0, deadlineEpochMs - Date.now()),
    );

    if (frame.type === "stream.open.ok" && frame.streamId === input.streamId) {
      continue;
    }
    if (frame.type === "stream.open.error" && frame.streamId === input.streamId) {
      throw new Error(`exec stream.open failed with ${frame.code}: ${frame.message}`);
    }
    if (frame.type === "stream.reset" && frame.streamId === input.streamId) {
      throw new Error(`exec stream reset with ${frame.code}: ${frame.message}`);
    }
    if (frame.type === "stream.complete" && frame.streamId === input.streamId) {
      if (execResult === undefined) {
        throw new Error("Received exec stream.complete before exec.result.");
      }

      return execResult;
    }
    if (
      frame.type === "stream.event" &&
      frame.streamId === input.streamId &&
      frame.event.type === "exec.result"
    ) {
      execResult = {
        exitCode: frame.event.exitCode,
        stdout: frame.event.stdout,
        stderr: frame.event.stderr,
        truncated: frame.event.truncated,
      };
    }
  }

  throw new Error(`Timed out after ${String(input.timeoutMs)}ms waiting for exec command result.`);
}

export async function expectSuccessfulExecCommand(input: {
  socket: WebSocket;
  pump: ControlMessagePump;
  streamId: number;
  command: string;
  args?: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  description: string;
  maxOutputBytes?: number;
}): Promise<string> {
  const resultInput: {
    socket: WebSocket;
    pump: ControlMessagePump;
    streamId: number;
    command: string;
    timeoutMs: number;
    args?: readonly string[];
    cwd?: string;
    maxOutputBytes?: number;
  } = {
    socket: input.socket,
    pump: input.pump,
    streamId: input.streamId,
    command: input.command,
    timeoutMs: input.timeoutMs ?? ExecCommandDefaultTimeoutMs,
  };

  if (input.args !== undefined) {
    resultInput.args = input.args;
  }
  if (input.cwd !== undefined) {
    resultInput.cwd = input.cwd;
  }
  if (input.maxOutputBytes !== undefined) {
    resultInput.maxOutputBytes = input.maxOutputBytes;
  }

  const result = await runExecCommand(resultInput);

  if (result.exitCode !== 0) {
    throw new Error(
      `${input.description} failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

async function collectFixtureFiles(input: {
  hostFixturePath: string;
  sandboxFixturePath: string;
}): Promise<FixtureFile[]> {
  const fixtureFiles: FixtureFile[] = [];

  const entries = await readdir(input.hostFixturePath, { withFileTypes: true });
  for (const entry of entries) {
    const hostPath = join(input.hostFixturePath, entry.name);
    const sandboxPath = `${input.sandboxFixturePath}/${entry.name}`;

    if (entry.isDirectory()) {
      fixtureFiles.push(
        ...(await collectFixtureFiles({
          hostFixturePath: hostPath,
          sandboxFixturePath: sandboxPath,
        })),
      );
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    fixtureFiles.push({
      contents: await readFile(hostPath, "utf8"),
      sandboxPath,
    });
  }

  fixtureFiles.sort((left, right) => left.sandboxPath.localeCompare(right.sandboxPath));
  return fixtureFiles;
}

export async function stageFixtureDirectory(input: {
  socket: WebSocket;
  pump: ControlMessagePump;
  allocateStreamId: () => number;
  hostFixturePath: string;
  sandboxFixturePath: string;
}): Promise<void> {
  const fixtureFiles = await collectFixtureFiles({
    hostFixturePath: input.hostFixturePath,
    sandboxFixturePath: input.sandboxFixturePath,
  });

  await expectSuccessfulExecCommand({
    socket: input.socket,
    pump: input.pump,
    streamId: input.allocateStreamId(),
    command: "sh",
    args: [
      "-lc",
      `rm -rf ${shellQuote(input.sandboxFixturePath)} && mkdir -p ${shellQuote(input.sandboxFixturePath)}`,
    ],
    description: `creating sandbox fixture directory '${input.sandboxFixturePath}'`,
  });

  for (const fixtureFile of fixtureFiles) {
    const relativePath = relative(input.sandboxFixturePath, fixtureFile.sandboxPath);
    const delimiter = `MISTLE_FIXTURE_${randomUUID().replaceAll("-", "")}`;
    const command = [
      `mkdir -p ${shellQuote(fixtureFile.sandboxPath.slice(0, fixtureFile.sandboxPath.lastIndexOf("/")))}`,
      `cat > ${shellQuote(fixtureFile.sandboxPath)} <<'${delimiter}'`,
      fixtureFile.contents,
      delimiter,
    ].join("\n");

    await expectSuccessfulExecCommand({
      socket: input.socket,
      pump: input.pump,
      streamId: input.allocateStreamId(),
      command: "sh",
      args: ["-lc", command],
      description: `staging fixture file '${relativePath}'`,
    });
  }
}

export async function waitForTcpListenerReady(input: {
  socket: WebSocket;
  pump: ControlMessagePump;
  allocateStreamId: () => number;
  port: number;
  logPath: string;
  description: string;
}): Promise<void> {
  try {
    await waitForCondition({
      description: input.description,
      timeoutMs: BootstrapReadyTimeoutMs,
      evaluate: async () => {
        const result = await runExecCommand({
          socket: input.socket,
          pump: input.pump,
          streamId: input.allocateStreamId(),
          command: NodeToolCommand,
          args: [
            "-e",
            [
              'const net = require("node:net");',
              `const socket = net.createConnection({ host: "127.0.0.1", port: ${String(input.port)} });`,
              "socket.setTimeout(1000);",
              'socket.once("connect", () => { socket.end(); process.exit(0); });',
              'socket.once("timeout", () => { socket.destroy(); process.exit(1); });',
              'socket.once("error", () => { process.exit(1); });',
            ].join(" "),
          ],
          timeoutMs: ListenerProbeTimeoutMs,
        });

        return result.exitCode === 0 ? true : null;
      },
    });
  } catch (error) {
    const logOutput = await expectSuccessfulExecCommand({
      socket: input.socket,
      pump: input.pump,
      streamId: input.allocateStreamId(),
      command: "sh",
      args: [
        "-lc",
        `test -f ${shellQuote(input.logPath)} && cat ${shellQuote(input.logPath)} || printf '<missing log>\\n'`,
      ],
      description: `reading listener log '${input.logPath}'`,
      timeoutMs: ListenerProbeTimeoutMs,
    }).catch((logError: unknown) => {
      return `<failed to read log: ${logError instanceof Error ? logError.message : String(logError)}>`;
    });

    throw new Error(
      `${input.description} failed: ${error instanceof Error ? error.message : String(error)}. Listener log: ${logOutput}`,
    );
  }
}

export async function sendGatewayHttpRequest(input: {
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
  const url = resolveUrlWithoutBaseQuery({
    baseUrl: input.baseUrl,
    path: input.path,
  });
  const requestHeaders = {
    ...readGatewayBaseUrlRequestHeaders(input.baseUrl),
    ...input.headers,
  };

  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: input.method,
        headers: requestHeaders,
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

async function sendHttpRequest(input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
}> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(
      input.url,
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

export async function bootstrapPortAccess(input: {
  fixture: Pick<CodexSandboxFixture, "controlPlaneApiBaseUrl" | "dataPlaneGatewayBaseUrl">;
  session: CodexSandboxAuthenticatedSession;
  bootstrap: PortAccessBootstrap;
}): Promise<string> {
  return await waitForCondition({
    description: `port access bootstrap for host '${input.bootstrap.host}'`,
    timeoutMs: BootstrapReadyTimeoutMs,
    evaluate: async () => {
      const linkResponse = await sendHttpRequest({
        url: resolvePortAccessApiUrl({
          controlPlaneApiBaseUrl: input.fixture.controlPlaneApiBaseUrl,
          portAccessUrl: input.bootstrap.url,
        }),
        method: "GET",
        headers: {
          ...readGatewayBaseUrlRequestHeaders(input.fixture.dataPlaneGatewayBaseUrl),
          cookie: input.session.cookie,
        },
      });

      if (linkResponse.status !== 302) {
        throw new Error(
          `Expected Port Access link status 302, got ${String(linkResponse.status)}. Response body: ${linkResponse.body}`,
        );
      }

      const bootstrapLocation = readHeaderValue(linkResponse.headers, "location");
      if (bootstrapLocation === undefined) {
        throw new Error("Expected Port Access link response to include location.");
      }

      const bootstrapUrl = new URL(bootstrapLocation);
      const response = await sendGatewayHttpRequest({
        baseUrl: input.fixture.dataPlaneGatewayBaseUrl,
        path: `${bootstrapUrl.pathname}${bootstrapUrl.search}`,
        method: "GET",
        headers: {
          host: bootstrapUrl.host,
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

function resolvePortAccessApiUrl(input: {
  controlPlaneApiBaseUrl: string;
  portAccessUrl: string;
}): string {
  const apiUrl = new URL(input.controlPlaneApiBaseUrl);
  const portAccessUrl = new URL(input.portAccessUrl);
  apiUrl.pathname = portAccessUrl.pathname;
  apiUrl.search = portAccessUrl.search;
  apiUrl.hash = "";
  return applyBaseUrlQueryParams({
    baseUrl: new URL(input.controlPlaneApiBaseUrl),
    url: apiUrl,
  }).toString();
}

export async function waitForWebSocketOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
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

export async function waitForWebSocketTextMessage(
  socket: WebSocket,
  timeoutMs: number,
): Promise<string> {
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

      resolve(decodeWebSocketText(data));
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

export async function closeWebSocketIfOpen(socket: WebSocket | undefined): Promise<void> {
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

export async function withTimeout<T>(input: {
  operation: Promise<T>;
  timeoutMs: number;
  description: string;
}): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = systemScheduler.schedule(() => {
      reject(new Error(`Timed out after ${String(input.timeoutMs)}ms: ${input.description}`));
    }, input.timeoutMs);

    input.operation.then(
      (value) => {
        systemScheduler.cancel(timeout);
        resolve(value);
      },
      (error: unknown) => {
        systemScheduler.cancel(timeout);
        reject(error);
      },
    );
  });
}
