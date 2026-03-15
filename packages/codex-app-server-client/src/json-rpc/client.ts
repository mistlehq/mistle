import {
  SandboxSessionClient,
  SandboxSessionSendGuarantees,
  type SandboxSessionSendGuarantee,
} from "@mistle/sandbox-session-client";
import type {
  JsonRpcErrorResponse as CodexJsonRpcErrorResponse,
  JsonRpcId as CodexJsonRpcId,
  JsonRpcNotification as CodexJsonRpcNotification,
  JsonRpcServerRequest as CodexJsonRpcServerRequest,
  JsonRpcSuccessResponse as CodexJsonRpcSuccessResponse,
  SandboxSessionEvent as CodexSessionEvent,
} from "@mistle/sandbox-session-client";

type PendingRequest = {
  method: string;
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

export class CodexJsonRpcRequestError extends Error {
  readonly method: string;
  readonly id: CodexJsonRpcId;
  readonly code: number;
  readonly data?: unknown;

  constructor(input: {
    method: string;
    id: CodexJsonRpcId;
    code: number;
    message: string;
    data?: unknown;
  }) {
    super(
      `JSON-RPC request ${String(input.id)} failed with code ${String(input.code)}: ${input.message}`,
    );
    this.name = "CodexJsonRpcRequestError";
    this.method = input.method;
    this.id = input.id;
    this.code = input.code;
    if (input.data !== undefined) {
      this.data = input.data;
    }
  }
}

export class CodexJsonRpcClient {
  readonly #sessionClient: SandboxSessionClient;
  readonly #pendingRequests = new Map<CodexJsonRpcId, PendingRequest>();
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #serverRequestListeners = new Set<ServerRequestListener>();
  readonly #unsubscribeSessionEvent: () => void;

  #nextId = 0;

  constructor(sessionClient: SandboxSessionClient) {
    this.#sessionClient = sessionClient;
    this.#unsubscribeSessionEvent = sessionClient.onEvent((event) => {
      this.#handleSessionEvent(event);
    });
  }

  dispose(): void {
    this.#unsubscribeSessionEvent();
    this.#rejectAllPendingRequests(new Error("Codex JSON-RPC client disposed."));
  }

  async initialize(input?: { clientInfo?: { name: string; version: string } }): Promise<unknown> {
    this.#sessionClient.markInitializing();
    const initializeResult = await this.call("initialize", {
      clientInfo: input?.clientInfo ?? {
        name: "mistle-dashboard",
        version: "0.1.0",
      },
    });
    const sendGuarantee = this.#sessionClient.sendGuarantee;
    await this.notify("initialized", {});
    await this.#confirmReadyState(sendGuarantee);
    if (this.#sessionClient.state !== "initializing") {
      throw new Error("Codex session connection ended before initialization completed.");
    }
    this.#sessionClient.markReady();
    return initializeResult;
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;

    return await new Promise<unknown>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        method,
        resolve,
        reject,
      });

      void this.#sessionClient
        .sendJson({
          id,
          method,
          ...(params === undefined ? {} : { params }),
        })
        .catch((error: unknown) => {
          this.#pendingRequests.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.#sessionClient.sendJson({
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  async respond(id: CodexJsonRpcId, result: unknown): Promise<void> {
    await this.#sessionClient.sendJson({
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
          new CodexJsonRpcRequestError({
            method: pendingRequest.method,
            id: event.response.id,
            code: event.response.error.code,
            message: event.response.error.message,
            ...(event.response.error.data === undefined ? {} : { data: event.response.error.data }),
          }),
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

  async #confirmReadyState(sendGuarantee: SandboxSessionSendGuarantee | null): Promise<void> {
    if (sendGuarantee !== SandboxSessionSendGuarantees.QUEUED) {
      return;
    }

    await this.call("thread/list", {
      limit: 1,
    });
  }
}
