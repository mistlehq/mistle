import { createHash } from "node:crypto";

import {
  AgentExecutionLeaseKinds,
  AgentExecutionObservationTypes,
  AgentExecutionStates,
  type AgentExecutionLease,
  type AgentExecutionObservation,
  type AgentExecutionObserver,
  type AgentExecutionObserverSession,
} from "@mistle/integrations-core";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";

const CodexExecutionLeaseSource = "codex";
const CodexInitializeClientInfo = {
  name: "mistle_sandbox_runtime",
  version: "0.1.0",
} as const;
const CodexJsonRpcErrorCodes = {
  INVALID_REQUEST: -32600,
} as const;
const CodexPollConnectTimeoutMs = 15_000;
const CodexPollRequestTimeoutMs = 60_000;

const ThreadReadResponseSchema = z.looseObject({
  thread: z.looseObject({
    turns: z
      .array(
        z.looseObject({
          id: z.string().min(1),
          status: z.string().min(1).optional(),
        }),
      )
      .optional(),
  }),
});

type PendingExecutionRequest = {
  method: string;
  threadId: string;
};

type ObservedExecution = {
  lease: AgentExecutionLease;
  threadId: string;
  turnId: string;
};

type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
};

type PollTurn = {
  id: string;
  status: string | null;
};

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(value));
}

function parseJsonObject(payload: string): Record<string, unknown> | undefined {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return undefined;
  }

  return readObject(parsedPayload);
}

function readJsonRpcId(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim().length === 0 ? undefined : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }

  return undefined;
}

function readNestedString(
  payload: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  let currentValue: unknown = payload;
  for (const segment of path) {
    const currentRecord = readObject(currentValue);
    if (currentRecord === undefined || !(segment in currentRecord)) {
      return undefined;
    }

    currentValue = currentRecord[segment];
  }

  return typeof currentValue === "string" && currentValue.trim().length > 0
    ? currentValue
    : undefined;
}

function parseObservedTurnRequest(
  payload: string,
): { id: string; method: string; threadId: string } | null {
  const envelope = parseJsonObject(payload);
  if (envelope === undefined) {
    return null;
  }

  const method = typeof envelope.method === "string" ? envelope.method : "";
  if (method !== "turn/start" && method !== "turn/steer") {
    return null;
  }

  const id = readJsonRpcId(envelope.id);
  if (id === undefined) {
    return null;
  }

  const params = readObject(envelope.params);
  const threadId = params === undefined ? undefined : readNestedString(params, ["threadId"]);
  if (threadId === undefined) {
    return null;
  }

  return {
    id,
    method,
    threadId,
  };
}

function parseObservedTurnResponse(
  payload: string,
): { id: string; result?: Record<string, unknown>; error?: JsonRpcErrorPayload } | null {
  const envelope = parseJsonObject(payload);
  if (envelope === undefined) {
    return null;
  }

  const id = readJsonRpcId(envelope.id);
  if (id === undefined) {
    return null;
  }

  let errorPayload: JsonRpcErrorPayload | undefined;
  const errorEnvelope = readObject(envelope.error);
  if (
    errorEnvelope !== undefined &&
    typeof errorEnvelope.code === "number" &&
    typeof errorEnvelope.message === "string"
  ) {
    errorPayload = {
      code: errorEnvelope.code,
      message: errorEnvelope.message,
      ...("data" in errorEnvelope ? { data: errorEnvelope.data } : {}),
    };
  }

  const result = readObject(envelope.result);

  return {
    id,
    ...(result === undefined ? {} : { result }),
    ...(errorPayload === undefined ? {} : { error: errorPayload }),
  };
}

function extractTurnIdFromResponse(
  method: string,
  result: Record<string, unknown>,
): string | undefined {
  switch (method) {
    case "turn/start":
      return readNestedString(result, ["turn", "id"]);
    case "turn/steer":
      return readNestedString(result, ["turnId"]);
    default:
      return undefined;
  }
}

function createCodexExecutionLeaseId(threadId: string, turnId: string): string {
  const digest = createHash("sha256")
    .update(threadId)
    .update("\u0000")
    .update(turnId)
    .digest("hex");

  return `sxl_codex_${digest.slice(0, 16)}`;
}

function createObservedExecution(threadId: string, turnId: string): ObservedExecution {
  return {
    lease: {
      leaseId: createCodexExecutionLeaseId(threadId, turnId),
      kind: AgentExecutionLeaseKinds.AGENT_EXECUTION,
      source: CodexExecutionLeaseSource,
      externalExecutionId: turnId,
      metadata: {
        threadId,
      },
    },
    threadId,
    turnId,
  };
}

class CodexExecutionObserverSession implements AgentExecutionObserverSession {
  readonly #transportUrl: string;
  readonly #pendingRequests = new Map<string, PendingExecutionRequest>();
  readonly #observedExecutions = new Map<string, ObservedExecution>();

  constructor(transportUrl: string) {
    this.#transportUrl = transportUrl;
  }

  onOutboundMessage(message: Uint8Array | string): void {
    if (typeof message !== "string") {
      return;
    }

    const request = parseObservedTurnRequest(message);
    if (request === null) {
      return;
    }

    this.#pendingRequests.set(request.id, {
      method: request.method,
      threadId: request.threadId,
    });
  }

  onInboundMessage(message: Uint8Array | string): void {
    if (typeof message !== "string") {
      return;
    }

    const response = parseObservedTurnResponse(message);
    if (response === null) {
      return;
    }

    const pendingRequest = this.#pendingRequests.get(response.id);
    if (pendingRequest === undefined) {
      return;
    }

    this.#pendingRequests.delete(response.id);
    if (response.error !== undefined || response.result === undefined) {
      return;
    }

    const turnId = extractTurnIdFromResponse(pendingRequest.method, response.result);
    if (turnId === undefined) {
      return;
    }

    const execution = createObservedExecution(pendingRequest.threadId, turnId);
    this.#observedExecutions.set(execution.lease.leaseId, execution);
  }

  drainObservations(): ReadonlyArray<AgentExecutionObservation> {
    const observedExecutions = [...this.#observedExecutions.values()];
    this.#pendingRequests.clear();
    this.#observedExecutions.clear();

    return observedExecutions.map((execution) => ({
      type: AgentExecutionObservationTypes.ACTIVE,
      lease: execution.lease,
      poll: async () =>
        await inspectCodexExecutionState({
          transportUrl: this.#transportUrl,
          threadId: execution.threadId,
          turnId: execution.turnId,
        }),
    }));
  }
}

class CodexPollClientRequestError extends Error {
  readonly method: string;
  readonly code: number;
  readonly responseMessage: string;
  readonly data?: unknown;

  constructor(input: { method: string; code: number; message: string; data?: unknown }) {
    super(
      `Codex JSON-RPC request '${input.method}' failed (${String(input.code)}): ${input.message}`,
    );
    this.method = input.method;
    this.code = input.code;
    this.responseMessage = input.message;
    if (input.data !== undefined) {
      this.data = input.data;
    }
  }
}

function isInvalidRequestError(
  error: unknown,
  method: string,
): error is CodexPollClientRequestError {
  return (
    error instanceof CodexPollClientRequestError &&
    error.method === method &&
    error.code === CodexJsonRpcErrorCodes.INVALID_REQUEST
  );
}

function isThreadReadNotLoadedError(error: unknown): boolean {
  return (
    isInvalidRequestError(error, "thread/read") &&
    error.responseMessage.startsWith("thread not loaded:")
  );
}

function isThreadMissingError(error: unknown): boolean {
  if (isInvalidRequestError(error, "thread/read")) {
    return (
      error.responseMessage.startsWith("invalid thread id:") ||
      error.responseMessage.startsWith("thread not found:")
    );
  }

  if (isInvalidRequestError(error, "thread/resume")) {
    return (
      error.responseMessage.startsWith("invalid thread id:") ||
      error.responseMessage.startsWith("thread not found:")
    );
  }

  return false;
}

function isThreadResumeNoRolloutError(error: unknown): boolean {
  return (
    isInvalidRequestError(error, "thread/resume") &&
    error.responseMessage.startsWith("no rollout found for thread id ")
  );
}

function normalizeTurnStatus(
  status: string | null,
): (typeof AgentExecutionStates)[keyof typeof AgentExecutionStates] {
  switch (status) {
    case "inProgress":
      return AgentExecutionStates.ACTIVE;
    case "completed":
    case "failed":
    case "interrupted":
      return AgentExecutionStates.TERMINAL;
    default:
      throw new Error(`unsupported Codex turn status '${String(status)}'`);
  }
}

async function inspectCodexExecutionState(input: {
  transportUrl: string;
  threadId: string;
  turnId: string;
}): Promise<(typeof AgentExecutionStates)[keyof typeof AgentExecutionStates]> {
  const socket = await connectWebSocket(input.transportUrl, CodexPollConnectTimeoutMs);

  try {
    const client = new CodexLeasePollClient(socket);
    await client.initialize();

    let turns: readonly PollTurn[];
    try {
      turns = await client.readThread(input.threadId);
    } catch (error) {
      if (!isThreadReadNotLoadedError(error)) {
        if (isThreadMissingError(error)) {
          return AgentExecutionStates.MISSING;
        }

        throw error;
      }

      try {
        await client.resumeThread(input.threadId);
      } catch (resumeError) {
        if (isThreadMissingError(resumeError) || isThreadResumeNoRolloutError(resumeError)) {
          return AgentExecutionStates.MISSING;
        }

        throw resumeError;
      }

      try {
        turns = await client.readThread(input.threadId);
      } catch (readAfterResumeError) {
        if (isThreadMissingError(readAfterResumeError)) {
          return AgentExecutionStates.MISSING;
        }

        throw readAfterResumeError;
      }
    }

    for (const turn of turns) {
      if (turn.id !== input.turnId) {
        continue;
      }

      return normalizeTurnStatus(turn.status);
    }

    return AgentExecutionStates.MISSING;
  } finally {
    await closeWebSocket(socket).catch(() => undefined);
  }
}

function rawDataToText(data: RawData, isBinary: boolean): string {
  if (isBinary) {
    throw new Error("Codex lease polling received an unexpected binary websocket message.");
  }

  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return data.toString("utf8");
}

class WebSocketTextMessageQueue {
  readonly #messages: string[] = [];
  readonly #pendingResolvers: Array<(message: string) => void> = [];
  readonly #pendingRejectors: Array<(error: Error) => void> = [];
  #failure: Error | undefined;

  constructor(socket: WebSocket) {
    socket.on("message", (data: RawData, isBinary: boolean) => {
      const message = rawDataToText(data, isBinary);
      const nextResolver = this.#pendingResolvers.shift();
      const nextRejector = this.#pendingRejectors.shift();
      if (nextResolver === undefined || nextRejector === undefined) {
        this.#messages.push(message);
        return;
      }

      nextResolver(message);
    });
    socket.once("error", (error: Error) => {
      this.#fail(error);
    });
    socket.once("close", () => {
      this.#fail(new Error("Codex websocket closed while awaiting a response."));
    });
  }

  next(timeoutMs: number): Promise<string> {
    const nextMessage = this.#messages.shift();
    if (nextMessage !== undefined) {
      return Promise.resolve(nextMessage);
    }
    if (this.#failure !== undefined) {
      return Promise.reject(this.#failure);
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const timeout: TimerHandle = systemScheduler.schedule(() => {
        settle(() =>
          reject(
            new Error(
              `timed out after ${String(timeoutMs)}ms waiting for Codex websocket response`,
            ),
          ),
        );
      }, timeoutMs);
      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }

        settled = true;
        systemScheduler.cancel(timeout);
        const resolverIndex = this.#pendingResolvers.indexOf(resolve);
        if (resolverIndex >= 0) {
          this.#pendingResolvers.splice(resolverIndex, 1);
        }
        const rejectorIndex = this.#pendingRejectors.indexOf(reject);
        if (rejectorIndex >= 0) {
          this.#pendingRejectors.splice(rejectorIndex, 1);
        }
        callback();
      };

      this.#pendingResolvers.push((message) => {
        settle(() => resolve(message));
      });
      this.#pendingRejectors.push((error) => {
        settle(() => reject(error));
      });
    });
  }

  #fail(error: Error): void {
    if (this.#failure !== undefined) {
      return;
    }

    this.#failure = error;
    while (this.#pendingRejectors.length > 0) {
      const rejector = this.#pendingRejectors.shift();
      this.#pendingResolvers.shift();
      rejector?.(error);
    }
  }
}

async function connectWebSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  const socket = new WebSocket(url);

  return await new Promise<WebSocket>((resolve, reject) => {
    let settled = false;
    const timeout: TimerHandle = systemScheduler.schedule(() => {
      settle(() => {
        socket.terminate();
        reject(new Error(`timed out after ${String(timeoutMs)}ms while connecting to '${url}'`));
      });
    }, timeoutMs);

    const cleanup = (): void => {
      systemScheduler.cancel(timeout);
      socket.off("open", handleOpen);
      socket.off("error", handleError);
      socket.off("close", handleClose);
    };

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleOpen = (): void => {
      settle(() => resolve(socket));
    };

    const handleError = (error: Error): void => {
      settle(() => reject(error));
    };

    const handleClose = (): void => {
      settle(() => reject(new Error(`Codex websocket '${url}' closed before it was ready.`)));
    };

    socket.once("open", handleOpen);
    socket.once("error", handleError);
    socket.once("close", handleClose);
  });
}

async function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const cleanup = (): void => {
      socket.off("close", handleClose);
      socket.off("error", handleError);
    };
    const settle = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    };
    const handleClose = (): void => {
      settle();
    };
    const handleError = (): void => {
      settle();
    };

    socket.once("close", handleClose);
    socket.once("error", handleError);
    socket.close();
  });
}

async function sendJsonMessage(socket: WebSocket, payload: object): Promise<void> {
  const message = JSON.stringify(payload);

  await new Promise<void>((resolve, reject) => {
    socket.send(message, (error?: Error | null) => {
      if (error == null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

class CodexLeasePollClient {
  readonly #socket: WebSocket;
  readonly #messages: WebSocketTextMessageQueue;
  #nextId = 1;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    this.#messages = new WebSocketTextMessageQueue(socket);
  }

  async initialize(): Promise<void> {
    await this.call("initialize", {
      clientInfo: CodexInitializeClientInfo,
    });
    await sendJsonMessage(this.#socket, {
      method: "initialized",
      params: {},
    });
  }

  async readThread(threadId: string): Promise<readonly PollTurn[]> {
    const response = await this.call("thread/read", {
      threadId,
      includeTurns: true,
    });

    const parsedResponse = ThreadReadResponseSchema.safeParse(response);
    if (!parsedResponse.success) {
      throw new Error(
        `thread/read response payload is invalid. Payload: ${JSON.stringify(response)}`,
      );
    }

    return (parsedResponse.data.thread.turns ?? []).map((turn) => ({
      id: turn.id,
      status: turn.status ?? null,
    }));
  }

  async resumeThread(threadId: string): Promise<void> {
    await this.call("thread/resume", {
      threadId,
    });
  }

  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = String(this.#nextId);
    this.#nextId += 1;

    await sendJsonMessage(this.#socket, {
      id,
      method,
      params,
    });

    while (true) {
      const message = await this.#messages.next(CodexPollRequestTimeoutMs);
      const response = parseObservedTurnResponse(message);
      if (response === null || response.id !== id) {
        continue;
      }
      if (response.error !== undefined) {
        throw new CodexPollClientRequestError({
          method,
          code: response.error.code,
          message: response.error.message,
          ...(response.error.data === undefined ? {} : { data: response.error.data }),
        });
      }
      if (response.result === undefined) {
        throw new Error(`Codex JSON-RPC response for '${method}' did not include a result.`);
      }

      return response.result;
    }
  }
}

export function createOpenAiExecutionObserver(): AgentExecutionObserver {
  return {
    createSession(input): AgentExecutionObserverSession {
      return new CodexExecutionObserverSession(input.transportUrl);
    },
  };
}
