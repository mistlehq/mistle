import type { StreamOpen, StreamOpenError, StreamOpenOK } from "@mistle/sandbox-session-protocol";

import {
  SandboxSessionSocketReadyStates,
  type SandboxSessionRuntime,
  type SandboxSessionSendGuarantee,
} from "./runtime.js";
import { isRecord } from "./shared/is-record.js";
import type {
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcServerRequest,
  JsonRpcSuccessResponse,
  SandboxSessionConnectionState,
  SandboxSessionEvent,
} from "./types.js";

const DefaultConnectTimeoutMs = 15_000;

export type SandboxSessionClientInput = {
  connectionUrl: string;
  runtime: SandboxSessionRuntime;
  connectTimeoutMs?: number;
};

type EventListener = (event: SandboxSessionEvent) => void;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readJsonRpcId(value: unknown): string | number | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

export function parseStreamOpenControlMessage(
  payload: string,
): StreamOpenOK | StreamOpenError | null {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(parsedPayload)) {
    return null;
  }

  const type = readString(parsedPayload.type);
  const streamId = readPositiveInteger(parsedPayload.streamId);
  if (type === null || streamId === null) {
    return null;
  }

  if (type === "stream.open.ok") {
    return {
      type,
      streamId,
    };
  }

  if (type === "stream.open.error") {
    const code = readString(parsedPayload.code);
    const message = readString(parsedPayload.message);
    if (code === null || message === null) {
      return null;
    }

    return {
      type,
      streamId,
      code,
      message,
    };
  }

  return null;
}

export function parseJsonRpcSuccessResponse(value: unknown): JsonRpcSuccessResponse | null {
  if (!isRecord(value) || !("result" in value)) {
    return null;
  }

  const id = readJsonRpcId(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    result: value.result,
  };
}

export function parseJsonRpcErrorResponse(value: unknown): JsonRpcErrorResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readJsonRpcId(value.id);
  const error = value.error;
  if (id === null || !isRecord(error)) {
    return null;
  }

  const code = error.code;
  const message = readString(error.message);
  if (typeof code !== "number" || !Number.isInteger(code) || message === null) {
    return null;
  }

  return {
    id,
    error: {
      code,
      message,
      ...("data" in error ? { data: error.data } : {}),
    },
  };
}

export function parseJsonRpcNotification(value: unknown): JsonRpcNotification | null {
  if (!isRecord(value) || "id" in value) {
    return null;
  }

  const method = readString(value.method);
  if (method === null) {
    return null;
  }

  return {
    method,
    ...("params" in value ? { params: value.params } : {}),
  };
}

export function parseJsonRpcServerRequest(value: unknown): JsonRpcServerRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readJsonRpcId(value.id);
  const method = readString(value.method);
  if (id === null || method === null) {
    return null;
  }

  return {
    id,
    method,
    ...("params" in value ? { params: value.params } : {}),
  };
}

function readTextPayload(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readMessageEventPayload(event: unknown): unknown {
  if (typeof event === "object" && event !== null && "data" in event) {
    return event.data;
  }

  return event;
}

export class SandboxSessionClient {
  readonly #connectionUrl: string;
  readonly #connectTimeoutMs: number;
  readonly #listeners = new Set<EventListener>();
  readonly #runtime: SandboxSessionRuntime;

  #socket: import("./runtime.js").SandboxSessionSocket | null = null;
  #state: SandboxSessionConnectionState = "idle";
  #errorMessage: string | null = null;
  #openError: StreamOpenError | null = null;
  #streamId: number | null = null;

  constructor(input: SandboxSessionClientInput) {
    this.#connectionUrl = input.connectionUrl;
    this.#runtime = input.runtime;
    this.#connectTimeoutMs = input.connectTimeoutMs ?? DefaultConnectTimeoutMs;
  }

  get state(): SandboxSessionConnectionState {
    return this.#state;
  }

  get errorMessage(): string | null {
    return this.#errorMessage;
  }

  get openError(): StreamOpenError | null {
    return this.#openError;
  }

  get socket(): import("./runtime.js").SandboxSessionSocket | null {
    return this.#socket;
  }

  get streamId(): number | null {
    return this.#streamId;
  }

  get sendGuarantee(): SandboxSessionSendGuarantee | null {
    return this.#socket?.sendGuarantee ?? null;
  }

  onEvent(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    if (this.#socket !== null) {
      throw new Error("Sandbox session client is already connected or connecting.");
    }

    this.#openError = null;
    this.#streamId = null;
    this.#setState("connecting_socket", null);

    const socket = this.#runtime.createSocket(this.#connectionUrl);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      const streamId = this.#runtime.createStreamId();
      this.#streamId = streamId;
      let settled = false;

      const timeoutTask = this.#runtime.scheduleTimeout(() => {
        fail(new Error("Timed out while opening agent session stream."));
      }, this.#connectTimeoutMs);

      const cleanup = (): void => {
        timeoutTask.cancel();
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.#setState("error", error.message);
        this.#socket = null;
        socket.close();
        reject(error);
      };

      const succeed = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.#setState("connected_socket", null);
        socket.addEventListener("message", this.#handleConnectedMessage);
        socket.addEventListener("close", this.#handleSocketClose);
        socket.addEventListener("error", this.#handleSocketError);
        resolve();
      };

      const handleOpen = (): void => {
        this.#setState("opening_agent_stream", null);
        const openMessage: StreamOpen = {
          type: "stream.open",
          streamId,
          channel: {
            kind: "agent",
          },
        };
        void socket.send(JSON.stringify(openMessage)).catch((error: unknown) => {
          fail(
            error instanceof Error
              ? error
              : new Error("Failed to send sandbox agent stream.open request."),
          );
        });
      };

      const handleMessage = (event: unknown): void => {
        const controlPayload = readTextPayload(readMessageEventPayload(event));
        if (controlPayload === null) {
          return;
        }

        const controlMessage = parseStreamOpenControlMessage(controlPayload);
        if (controlMessage === null || controlMessage.streamId !== streamId) {
          return;
        }

        if (controlMessage.type === "stream.open.ok") {
          succeed();
          return;
        }

        this.#openError = controlMessage;
        fail(new Error(controlMessage.message));
      };

      const handleError = (): void => {
        fail(new Error("Sandbox websocket connection failed."));
      };

      const handleClose = (): void => {
        fail(new Error("Sandbox websocket connection closed before agent stream was ready."));
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  disconnect(closeCode = 1000, reason = "Disconnected by dashboard."): void {
    const socket = this.#socket;
    this.#socket = null;

    if (socket === null) {
      this.#setState("closed", null);
      return;
    }

    socket.removeEventListener("message", this.#handleConnectedMessage);
    socket.removeEventListener("close", this.#handleSocketClose);
    socket.removeEventListener("error", this.#handleSocketError);
    socket.close(closeCode, reason);
    this.#setState("closed", null);
  }

  async sendJson(payload: unknown): Promise<void> {
    await this.sendText(JSON.stringify(payload));
  }

  async sendText(payload: string): Promise<void> {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session socket is not open.");
    }

    await socket.send(payload);
  }

  markInitializing(): void {
    this.#setState("initializing", null);
  }

  markReady(): void {
    this.#setState("ready", null);
  }

  #setState(state: SandboxSessionConnectionState, errorMessage: string | null): void {
    this.#state = state;
    this.#errorMessage = errorMessage;
    this.#emit({
      type: "connection_state_changed",
      state,
      errorMessage,
    });
  }

  #emit(event: SandboxSessionEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  readonly #handleConnectedMessage = (event: unknown): void => {
    const messagePayload = readTextPayload(readMessageEventPayload(event));
    if (messagePayload === null) {
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(messagePayload);
    } catch {
      this.#emit({
        type: "unhandled_message",
        payload: messagePayload,
      });
      return;
    }

    const successResponse = parseJsonRpcSuccessResponse(parsedPayload);
    if (successResponse !== null) {
      this.#emit({
        type: "response",
        response: successResponse,
      });
      return;
    }

    const errorResponse = parseJsonRpcErrorResponse(parsedPayload);
    if (errorResponse !== null) {
      this.#emit({
        type: "response",
        response: errorResponse,
      });
      return;
    }

    const serverRequest = parseJsonRpcServerRequest(parsedPayload);
    if (serverRequest !== null) {
      this.#emit({
        type: "server_request",
        request: serverRequest,
      });
      return;
    }

    const notification = parseJsonRpcNotification(parsedPayload);
    if (notification !== null) {
      this.#emit({
        type: "notification",
        notification,
      });
      return;
    }

    this.#emit({
      type: "unhandled_message",
      payload: parsedPayload,
    });
  };

  readonly #handleSocketClose = (): void => {
    this.#socket = null;
    if (this.#state !== "closed") {
      this.#setState("closed", "Sandbox websocket connection closed.");
    }
  };

  readonly #handleSocketError = (): void => {
    this.#setState("error", "Sandbox websocket connection failed.");
  };
}
