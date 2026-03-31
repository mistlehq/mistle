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

import {
  type OpencodeBridgeConversationInspectResult,
  OpencodeBridgeConversationInspectResultSchema,
  OpencodeBridgeJsonRpcErrorCodes,
  OpencodeBridgeMethodNames,
} from "./bridge-protocol.js";

const OpencodeExecutionLeaseSource = "opencode";
const OpencodePollConnectTimeoutMs = 15_000;
const OpencodePollRequestTimeoutMs = 60_000;

type PendingExecutionRequest = {
  method: string;
  providerConversationId: string;
};

type ObservedExecution = {
  lease: AgentExecutionLease;
  providerConversationId: string;
  providerExecutionId: string;
};

type JsonRpcErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
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

function parseObservedExecutionRequest(
  payload: string,
): { id: string; method: string; providerConversationId: string } | null {
  const envelope = parseJsonObject(payload);
  if (envelope === undefined) {
    return null;
  }

  const method = typeof envelope.method === "string" ? envelope.method : "";
  if (
    method !== OpencodeBridgeMethodNames.EXECUTION_START &&
    method !== OpencodeBridgeMethodNames.EXECUTION_STEER
  ) {
    return null;
  }

  const id = readJsonRpcId(envelope.id);
  if (id === undefined) {
    return null;
  }

  const params = readObject(envelope.params);
  const providerConversationId =
    params !== undefined && typeof params.providerConversationId === "string"
      ? params.providerConversationId
      : undefined;
  if (providerConversationId === undefined || providerConversationId.trim().length === 0) {
    return null;
  }

  return {
    id,
    method,
    providerConversationId,
  };
}

function parseObservedExecutionResponse(
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

function createOpencodeExecutionLeaseId(
  providerConversationId: string,
  providerExecutionId: string,
): string {
  const digest = createHash("sha256")
    .update(providerConversationId)
    .update("\u0000")
    .update(providerExecutionId)
    .digest("hex");

  return `sxl_opencode_${digest.slice(0, 16)}`;
}

function createObservedExecution(
  providerConversationId: string,
  providerExecutionId: string,
): ObservedExecution {
  return {
    lease: {
      leaseId: createOpencodeExecutionLeaseId(providerConversationId, providerExecutionId),
      kind: AgentExecutionLeaseKinds.AGENT_EXECUTION,
      source: OpencodeExecutionLeaseSource,
      externalExecutionId: providerExecutionId,
      metadata: {
        providerConversationId,
      },
    },
    providerConversationId,
    providerExecutionId,
  };
}

class OpencodeExecutionObserverSession implements AgentExecutionObserverSession {
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

    const request = parseObservedExecutionRequest(message);
    if (request === null) {
      return;
    }

    this.#pendingRequests.set(request.id, {
      method: request.method,
      providerConversationId: request.providerConversationId,
    });
  }

  onInboundMessage(message: Uint8Array | string): void {
    if (typeof message !== "string") {
      return;
    }

    const response = parseObservedExecutionResponse(message);
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

    const providerExecutionId = response.result.providerExecutionId;
    if (typeof providerExecutionId !== "string" || providerExecutionId.trim().length === 0) {
      return;
    }

    const execution = createObservedExecution(
      pendingRequest.providerConversationId,
      providerExecutionId,
    );
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
        await inspectOpencodeExecutionState({
          transportUrl: this.#transportUrl,
          providerConversationId: execution.providerConversationId,
          providerExecutionId: execution.providerExecutionId,
        }),
    }));
  }
}

class OpencodeBridgePollClientRequestError extends Error {
  readonly method: string;
  readonly code: number;
  readonly responseMessage: string;
  readonly data?: unknown;

  constructor(input: { method: string; code: number; message: string; data?: unknown }) {
    super(
      `OpenCode bridge request '${input.method}' failed (${String(input.code)}): ${input.message}`,
    );
    this.method = input.method;
    this.code = input.code;
    this.responseMessage = input.message;
    if (input.data !== undefined) {
      this.data = input.data;
    }
  }
}

function isConversationMissingError(error: unknown): boolean {
  if (!(error instanceof OpencodeBridgePollClientRequestError)) {
    return false;
  }
  if (error.method !== OpencodeBridgeMethodNames.CONVERSATION_INSPECT) {
    return false;
  }
  if (error.code !== OpencodeBridgeJsonRpcErrorCodes.UPSTREAM_REQUEST_FAILED) {
    return false;
  }

  const errorData = readObject(error.data);
  return errorData?.status === 404;
}

async function inspectOpencodeExecutionState(input: {
  transportUrl: string;
  providerConversationId: string;
  providerExecutionId: string;
}): Promise<(typeof AgentExecutionStates)[keyof typeof AgentExecutionStates]> {
  const socket = await connectWebSocket(input.transportUrl, OpencodePollConnectTimeoutMs);

  try {
    const client = new OpencodeLeasePollClient(socket);
    let inspectResult: OpencodeBridgeConversationInspectResult;
    try {
      inspectResult = await client.inspectConversation(input.providerConversationId);
    } catch (error) {
      if (isConversationMissingError(error)) {
        return AgentExecutionStates.MISSING;
      }

      throw error;
    }

    if (!inspectResult.exists) {
      return AgentExecutionStates.MISSING;
    }
    if (inspectResult.status === "active") {
      return inspectResult.activeExecutionId === input.providerExecutionId
        ? AgentExecutionStates.ACTIVE
        : AgentExecutionStates.TERMINAL;
    }

    return AgentExecutionStates.TERMINAL;
  } finally {
    await closeWebSocket(socket).catch(() => undefined);
  }
}

function rawDataToText(data: RawData, isBinary: boolean): string {
  if (isBinary) {
    throw new Error("OpenCode lease polling received an unexpected binary websocket message.");
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
      this.#fail(new Error("OpenCode bridge websocket closed while awaiting a response."));
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
      const timeout: TimerHandle = systemScheduler.schedule(() => {
        cleanup();
        reject(
          new Error(`timed out after ${String(timeoutMs)}ms waiting for OpenCode bridge response`),
        );
      }, timeoutMs);

      const cleanup = (): void => {
        systemScheduler.cancel(timeout);
        const resolverIndex = this.#pendingResolvers.indexOf(resolve);
        if (resolverIndex >= 0) {
          this.#pendingResolvers.splice(resolverIndex, 1);
        }
        const rejectorIndex = this.#pendingRejectors.indexOf(reject);
        if (rejectorIndex >= 0) {
          this.#pendingRejectors.splice(rejectorIndex, 1);
        }
      };

      this.#pendingResolvers.push((message) => {
        cleanup();
        resolve(message);
      });
      this.#pendingRejectors.push((error) => {
        cleanup();
        reject(error);
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

class OpencodeLeasePollClient {
  readonly #socket: WebSocket;
  readonly #messages: WebSocketTextMessageQueue;
  #nextId = 0;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    this.#messages = new WebSocketTextMessageQueue(socket);
  }

  async inspectConversation(
    providerConversationId: string,
  ): Promise<OpencodeBridgeConversationInspectResult> {
    const response = await this.#call(OpencodeBridgeMethodNames.CONVERSATION_INSPECT, {
      providerConversationId,
    });

    const parsed = OpencodeBridgeConversationInspectResultSchema.safeParse(response);
    if (!parsed.success) {
      throw new Error(
        `OpenCode bridge inspect response payload is invalid. Payload: ${JSON.stringify(response)}`,
      );
    }

    return parsed.data;
  }

  async #call(method: string, params: unknown): Promise<unknown> {
    const requestId = this.#nextId.toString();
    this.#nextId += 1;

    await this.#sendJson({
      jsonrpc: "2.0",
      id: requestId,
      method,
      params,
    });

    while (true) {
      const rawPayload = await this.#messages.next(OpencodePollRequestTimeoutMs);
      const parsedPayload = parseJsonObject(rawPayload);
      if (parsedPayload === undefined) {
        throw new Error(`OpenCode bridge returned invalid JSON payload: ${rawPayload}`);
      }

      const payloadId = readJsonRpcId(parsedPayload.id);
      if (payloadId !== requestId) {
        continue;
      }

      const errorEnvelope = readObject(parsedPayload.error);
      if (
        errorEnvelope !== undefined &&
        typeof errorEnvelope.code === "number" &&
        typeof errorEnvelope.message === "string"
      ) {
        throw new OpencodeBridgePollClientRequestError({
          method,
          code: errorEnvelope.code,
          message: errorEnvelope.message,
          ...("data" in errorEnvelope ? { data: errorEnvelope.data } : {}),
        });
      }

      if (!("result" in parsedPayload)) {
        throw new Error(`OpenCode bridge response for '${method}' did not include a result.`);
      }

      return parsedPayload.result;
    }
  }

  async #sendJson(payload: unknown): Promise<void> {
    const serializedPayload = JSON.stringify(payload);
    await new Promise<void>((resolve, reject) => {
      this.#socket.send(serializedPayload, (error) => {
        if (error == null) {
          resolve();
          return;
        }

        reject(error);
      });
    });
  }
}

function connectWebSocket(url: string, timeoutMs: number): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);

    const timeout: TimerHandle = systemScheduler.schedule(() => {
      socket.removeAllListeners();
      socket.terminate();
      reject(new Error(`timed out after ${String(timeoutMs)}ms connecting to ${url}`));
    }, timeoutMs);

    const cleanup = (): void => {
      systemScheduler.cancel(timeout);
      socket.removeAllListeners("open");
      socket.removeAllListeners("error");
    };

    socket.once("open", () => {
      cleanup();
      resolve(socket);
    });
    socket.once("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve) => {
    if (socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }

    socket.once("close", () => resolve());
    socket.close();
  });
}

export function createOpencodeExecutionObserver(): AgentExecutionObserver {
  return {
    createSession: ({ transportUrl }) => new OpencodeExecutionObserverSession(transportUrl),
  };
}
