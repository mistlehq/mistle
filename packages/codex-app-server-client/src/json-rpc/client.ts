import { CodexSessionClient } from "../session/client.js";
import type {
  CodexJsonRpcErrorResponse,
  CodexJsonRpcId,
  CodexJsonRpcNotification,
  CodexJsonRpcServerRequest,
  CodexJsonRpcSuccessResponse,
  CodexSessionEvent,
} from "../session/types.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type NotificationListener = (notification: CodexJsonRpcNotification) => void;
type ServerRequestListener = (request: CodexJsonRpcServerRequest) => void;

function isErrorResponse(
  response: CodexJsonRpcSuccessResponse | CodexJsonRpcErrorResponse,
): response is CodexJsonRpcErrorResponse {
  return "error" in response;
}

export class CodexJsonRpcClient {
  readonly #sessionClient: CodexSessionClient;
  readonly #pendingRequests = new Map<CodexJsonRpcId, PendingRequest>();
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #serverRequestListeners = new Set<ServerRequestListener>();
  readonly #unsubscribeSessionEvent: () => void;

  #nextId = 0;

  constructor(sessionClient: CodexSessionClient) {
    this.#sessionClient = sessionClient;
    this.#unsubscribeSessionEvent = sessionClient.onEvent((event) => {
      this.#handleSessionEvent(event);
    });
  }

  dispose(): void {
    this.#unsubscribeSessionEvent();
    this.#rejectAllPendingRequests(new Error("Codex JSON-RPC client disposed."));
  }

  async initialize(input?: { clientInfo?: { name: string; version: string } }): Promise<void> {
    this.#sessionClient.markInitializing();
    await this.call("initialize", {
      clientInfo: input?.clientInfo ?? {
        name: "mistle-dashboard",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
    this.#sessionClient.markReady();
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;

    return await new Promise<unknown>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        resolve,
        reject,
      });

      try {
        this.#sessionClient.sendJson({
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      } catch (error) {
        this.#pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.#sessionClient.sendJson({
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  respond(id: CodexJsonRpcId, result: unknown): void {
    this.#sessionClient.sendJson({
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

  #handleSessionEvent(event: CodexSessionEvent): void {
    if (event.type === "notification") {
      for (const listener of this.#notificationListeners) {
        listener(event.notification);
      }
      return;
    }

    if (event.type === "server_request") {
      for (const listener of this.#serverRequestListeners) {
        listener(event.request);
      }
      return;
    }

    if (event.type === "response") {
      const pendingRequest = this.#pendingRequests.get(event.response.id);
      if (pendingRequest === undefined) {
        return;
      }

      this.#pendingRequests.delete(event.response.id);
      if (isErrorResponse(event.response)) {
        pendingRequest.reject(
          new Error(
            `JSON-RPC request ${String(event.response.id)} failed with code ${String(event.response.error.code)}: ${event.response.error.message}`,
          ),
        );
        return;
      }

      pendingRequest.resolve(event.response.result);
      return;
    }

    if (
      event.type === "connection_state_changed" &&
      (event.state === "closed" || event.state === "error")
    ) {
      this.#rejectAllPendingRequests(
        new Error(event.errorMessage ?? "Codex session connection ended."),
      );
    }
  }

  #rejectAllPendingRequests(error: Error): void {
    for (const pendingRequest of this.#pendingRequests.values()) {
      pendingRequest.reject(error);
    }
    this.#pendingRequests.clear();
  }
}
