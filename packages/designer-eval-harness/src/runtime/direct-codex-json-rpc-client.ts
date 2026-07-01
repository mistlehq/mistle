import type {
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcServerRequest,
} from "@mistle/sandbox-session-client";
import { systemScheduler } from "@mistle/time";
import { WebSocket } from "ws";

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type NotificationListener = (notification: JsonRpcNotification) => void;
type ServerRequestListener = (request: JsonRpcServerRequest) => void;

const DefaultConnectTimeoutMs = 30_000;

export type DirectCodexJsonRpcClient = {
  call: (method: string, params?: unknown) => Promise<unknown>;
  dispose: () => void;
  initialize: () => Promise<unknown>;
  notify: (method: string, params?: unknown) => Promise<void>;
  onNotification: (listener: NotificationListener) => () => void;
  onServerRequest: (listener: ServerRequestListener) => () => void;
  respond: (id: JsonRpcId, result: unknown) => Promise<void>;
};

export async function connectDirectCodexJsonRpcClient(input: {
  authorizationBearerToken?: string;
  websocketUrl: string;
  connectTimeoutMs?: number;
}): Promise<DirectCodexJsonRpcClient> {
  const socket = await connectWebSocket({
    ...(input.authorizationBearerToken === undefined
      ? {}
      : { authorizationBearerToken: input.authorizationBearerToken }),
    websocketUrl: input.websocketUrl,
    connectTimeoutMs: input.connectTimeoutMs ?? DefaultConnectTimeoutMs,
  });

  return new DirectCodexJsonRpcWebSocketClient(socket);
}

class DirectCodexJsonRpcWebSocketClient implements DirectCodexJsonRpcClient {
  readonly #socket: WebSocket;
  readonly #pendingRequests = new Map<JsonRpcId, PendingRequest>();
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #serverRequestListeners = new Set<ServerRequestListener>();
  #nextId = 0;

  constructor(socket: WebSocket) {
    this.#socket = socket;
    this.#socket.addEventListener("message", (event) => {
      void this.#handleMessageData(event.data);
    });
    this.#socket.addEventListener("close", () => {
      this.#rejectAllPendingRequests(new Error("Codex app-server websocket closed."));
    });
    this.#socket.addEventListener("error", () => {
      this.#rejectAllPendingRequests(new Error("Codex app-server websocket errored."));
    });
  }

  dispose(): void {
    this.#rejectAllPendingRequests(new Error("Codex JSON-RPC client disposed."));
    this.#socket.close(1000, "Designer eval completed.");
  }

  async initialize(): Promise<unknown> {
    const initializeResult = await this.call("initialize", {
      clientInfo: {
        name: "mistle-designer-eval",
        version: "0.0.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    await this.notify("initialized", {});
    return initializeResult;
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;

    const promise = new Promise<unknown>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        method,
        resolve,
        reject,
      });
    });

    try {
      this.#sendJson({
        id,
        method,
        ...(params === undefined ? {} : { params }),
      });
    } catch (error) {
      this.#rejectPendingRequest(
        id,
        error instanceof Error
          ? error
          : new Error(`JSON-RPC request '${method}' could not be sent.`),
      );
    }

    return await promise;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.#sendJson({
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    this.#sendJson({
      id,
      result,
    });
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => {
      this.#notificationListeners.delete(listener);
    };
  }

  onServerRequest(listener: ServerRequestListener): () => void {
    this.#serverRequestListeners.add(listener);
    return () => {
      this.#serverRequestListeners.delete(listener);
    };
  }

  async #handleMessageData(data: unknown): Promise<void> {
    const text = await readWebSocketMessageText(data);
    const payload = JSON.parse(text);
    if (!isJsonRpcObject(payload)) {
      return;
    }

    if (isJsonRpcResponse(payload)) {
      this.#handleResponse(payload);
      return;
    }

    if (isJsonRpcServerRequest(payload)) {
      for (const listener of this.#serverRequestListeners) {
        listener(payload);
      }
      return;
    }

    if (isJsonRpcNotification(payload)) {
      for (const listener of this.#notificationListeners) {
        listener(payload);
      }
    }
  }

  #handleResponse(response: JsonRpcResponse): void {
    const pendingRequest = this.#pendingRequests.get(response.id);
    if (pendingRequest === undefined) {
      return;
    }

    this.#pendingRequests.delete(response.id);
    if ("error" in response) {
      pendingRequest.reject(
        new Error(
          `JSON-RPC request ${String(response.id)} '${pendingRequest.method}' failed: ${response.error.message}`,
        ),
      );
      return;
    }

    pendingRequest.resolve(response.result);
  }

  #sendJson(payload: unknown): void {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error("Codex app-server websocket is not open.");
    }

    this.#socket.send(JSON.stringify(payload));
  }

  #rejectAllPendingRequests(error: Error): void {
    for (const pendingRequest of this.#pendingRequests.values()) {
      pendingRequest.reject(error);
    }
    this.#pendingRequests.clear();
  }

  #rejectPendingRequest(id: JsonRpcId, error: Error): void {
    const pendingRequest = this.#pendingRequests.get(id);
    if (pendingRequest === undefined) {
      return;
    }

    this.#pendingRequests.delete(id);
    pendingRequest.reject(error);
  }
}

type JsonRpcObject = Record<string, unknown>;

type JsonRpcResponse =
  | {
      id: JsonRpcId;
      result: unknown;
    }
  | {
      id: JsonRpcId;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };

function connectWebSocket(input: {
  authorizationBearerToken?: string;
  websocketUrl: string;
  connectTimeoutMs: number;
}): Promise<WebSocket> {
  const socket =
    input.authorizationBearerToken === undefined
      ? new WebSocket(input.websocketUrl)
      : new WebSocket(input.websocketUrl, {
          headers: {
            Authorization: `Bearer ${input.authorizationBearerToken}`,
          },
        });

  return new Promise<WebSocket>((resolve, reject) => {
    const timeout = systemScheduler.schedule(() => {
      cleanup();
      socket.close();
      reject(
        new Error(
          `Timed out waiting ${String(input.connectTimeoutMs)}ms for Codex app-server websocket.`,
        ),
      );
    }, input.connectTimeoutMs);

    const handleOpen = (): void => {
      cleanup();
      resolve(socket);
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error("Codex app-server websocket connection failed."));
    };
    const cleanup = (): void => {
      systemScheduler.cancel(timeout);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("error", handleError);
  });
}

async function readWebSocketMessageText(data: unknown): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (data instanceof Blob) {
    return await data.text();
  }

  throw new Error("Unsupported Codex app-server websocket message payload.");
}

function isJsonRpcObject(value: unknown): value is JsonRpcObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null;
}

function isJsonRpcResponse(value: JsonRpcObject): value is JsonRpcResponse {
  const id = Reflect.get(value, "id");
  if (!isJsonRpcId(id)) {
    return false;
  }
  if ("result" in value) {
    return true;
  }

  const error = Reflect.get(value, "error");
  return (
    isJsonRpcObject(error) &&
    typeof Reflect.get(error, "code") === "number" &&
    typeof Reflect.get(error, "message") === "string"
  );
}

function isJsonRpcServerRequest(value: JsonRpcObject): value is JsonRpcServerRequest {
  return isJsonRpcId(Reflect.get(value, "id")) && typeof Reflect.get(value, "method") === "string";
}

function isJsonRpcNotification(value: JsonRpcObject): value is JsonRpcNotification {
  return !("id" in value) && typeof Reflect.get(value, "method") === "string";
}
