import type {
  AgentConnectRequest,
  ConnectError,
  ConnectOK,
} from "@mistle/sandbox-session-protocol";

import { SandboxAgentSocketReadyStates, type SandboxAgentRuntime } from "./runtime.js";
import type {
  SandboxAgentJsonRpcErrorResponse,
  SandboxAgentJsonRpcNotification,
  SandboxAgentJsonRpcServerRequest,
  SandboxAgentJsonRpcSuccessResponse,
  SandboxAgentConnectionState,
  SandboxAgentEvent,
} from "./types.js";

const DefaultConnectTimeoutMs = 15_000;

export type SandboxAgentClientInput = {
  connectionUrl: string;
  runtime: SandboxAgentRuntime;
  connectTimeoutMs?: number;
};

type EventListener = (event: SandboxAgentEvent) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

export function parseConnectControlMessage(payload: string): ConnectOK | ConnectError | null {
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
  const requestId = readString(parsedPayload.requestId);
  if (type === null || requestId === null) {
    return null;
  }

  if (type === "connect.ok") {
    return {
      type,
      requestId,
    };
  }

  if (type === "connect.error") {
    const code = readString(parsedPayload.code);
    const message = readString(parsedPayload.message);
    if (code === null || message === null) {
      return null;
    }

    return {
      type,
      requestId,
      code,
      message,
    };
  }

  return null;
}

export function parseJsonRpcSuccessResponse(
  value: unknown,
): SandboxAgentJsonRpcSuccessResponse | null {
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

export function parseJsonRpcErrorResponse(value: unknown): SandboxAgentJsonRpcErrorResponse | null {
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

export function parseJsonRpcNotification(value: unknown): SandboxAgentJsonRpcNotification | null {
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

export function parseJsonRpcServerRequest(value: unknown): SandboxAgentJsonRpcServerRequest | null {
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

export class SandboxAgentClient {
  readonly #connectionUrl: string;
  readonly #connectTimeoutMs: number;
  readonly #listeners = new Set<EventListener>();
  readonly #runtime: SandboxAgentRuntime;

  #socket: import("./runtime.js").SandboxAgentSocket | null = null;
  #state: SandboxAgentConnectionState = "idle";
  #errorMessage: string | null = null;

  constructor(input: SandboxAgentClientInput) {
    this.#connectionUrl = input.connectionUrl;
    this.#runtime = input.runtime;
    this.#connectTimeoutMs = input.connectTimeoutMs ?? DefaultConnectTimeoutMs;
  }

  get state(): SandboxAgentConnectionState {
    return this.#state;
  }

  get errorMessage(): string | null {
    return this.#errorMessage;
  }

  onEvent(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    if (this.#socket !== null) {
      throw new Error("Sandbox agent client is already connected or connecting.");
    }

    this.#setState("connecting_socket", null);

    const socket = this.#runtime.createSocket(this.#connectionUrl);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      const connectRequestId = this.#runtime.createRequestId();
      let settled = false;

      const timeoutTask = this.#runtime.scheduleTimeout(() => {
        fail(new Error("Timed out while establishing agent session connection."));
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
        this.#setState("handshaking_agent", null);
        const connectRequest: AgentConnectRequest = {
          type: "connect",
          v: 1,
          requestId: connectRequestId,
          channel: {
            kind: "agent",
          },
        };
        socket.send(JSON.stringify(connectRequest));
      };

      const handleMessage = (event: unknown): void => {
        const controlPayload = readTextPayload(readMessageEventPayload(event));
        if (controlPayload === null) {
          return;
        }

        const controlMessage = parseConnectControlMessage(controlPayload);
        if (controlMessage === null || controlMessage.requestId !== connectRequestId) {
          return;
        }

        if (controlMessage.type === "connect.ok") {
          succeed();
          return;
        }

        fail(new Error(controlMessage.message));
      };

      const handleError = (): void => {
        fail(new Error("Sandbox websocket connection failed."));
      };

      const handleClose = (): void => {
        fail(new Error("Sandbox websocket connection closed before agent channel was ready."));
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

  sendJson(payload: unknown): void {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== SandboxAgentSocketReadyStates.OPEN) {
      throw new Error("Sandbox agent socket is not open.");
    }

    socket.send(JSON.stringify(payload));
  }

  markInitializing(): void {
    this.#setState("initializing", null);
  }

  markReady(): void {
    this.#setState("ready", null);
  }

  #setState(state: SandboxAgentConnectionState, errorMessage: string | null): void {
    this.#state = state;
    this.#errorMessage = errorMessage;
    this.#emit({
      type: "connection_state_changed",
      state,
      errorMessage,
    });
  }

  #emit(event: SandboxAgentEvent): void {
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
