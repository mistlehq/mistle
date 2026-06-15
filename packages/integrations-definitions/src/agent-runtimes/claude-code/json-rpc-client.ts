import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import {
  AgentStreamClient,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcSuccessResponse,
  type SandboxSessionEvent,
  type SandboxSessionResetInfo,
} from "@mistle/sandbox-session-client";

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type ClaudeCodeJsonRpcCallOptions = {
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

function createStreamResetError(input: {
  pendingMethods: readonly string[];
  resetInfo: SandboxSessionResetInfo;
}): Error {
  const pendingMethodSummary =
    input.pendingMethods.length === 0
      ? ""
      : ` Pending JSON-RPC methods: ${input.pendingMethods.join(", ")}.`;
  return new Error(
    `Sandbox session stream reset (${input.resetInfo.code}): ${input.resetInfo.message}${pendingMethodSummary}`,
  );
}

function isErrorResponse(
  response: JsonRpcSuccessResponse | JsonRpcErrorResponse,
): response is JsonRpcErrorResponse {
  return "error" in response;
}

export class ClaudeCodeJsonRpcRequestError extends Error {
  readonly method: string;
  readonly id: JsonRpcId;
  readonly code: number;
  readonly data?: unknown;

  constructor(input: {
    code: number;
    data?: unknown;
    id: JsonRpcId;
    message: string;
    method: string;
  }) {
    super(
      `JSON-RPC request ${String(input.id)} failed with code ${String(input.code)}: ${input.message}`,
    );
    this.name = "ClaudeCodeJsonRpcRequestError";
    this.method = input.method;
    this.id = input.id;
    this.code = input.code;
    if (input.data !== undefined) {
      this.data = input.data;
    }
  }
}

export class ClaudeCodeJsonRpcClient {
  readonly #pendingRequests = new Map<JsonRpcId, PendingRequest>();
  readonly #sessionClient: AgentStreamClient;
  readonly #unsubscribeSessionEvent: () => void;

  #nextId = 0;

  constructor(sessionClient: AgentStreamClient) {
    this.#sessionClient = sessionClient;
    this.#unsubscribeSessionEvent = sessionClient.onEvent((event) => {
      this.#handleSessionEvent(event);
    });
  }

  dispose(): void {
    this.#unsubscribeSessionEvent();
    this.#rejectAllPendingRequests(new Error("Claude Code JSON-RPC client disposed."));
  }

  async initialize(): Promise<unknown> {
    this.#sessionClient.markInitializing();
    const initializeResult = await this.call("initialize", {
      clientInfo: {
        name: "mistle",
        version: "1",
      },
    });
    await this.notify("initialized", {});
    if (this.#sessionClient.state !== "initializing") {
      throw new Error("Claude Code session connection ended before initialization completed.");
    }
    this.#sessionClient.markReady();
    return initializeResult;
  }

  async call(
    method: string,
    params?: unknown,
    options?: ClaudeCodeJsonRpcCallOptions,
  ): Promise<unknown> {
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
          ...(options?.idempotency === undefined ? {} : { idempotency: options.idempotency }),
        })
        .catch((error: unknown) => {
          const cause = error instanceof Error ? error : new Error(String(error));
          this.#rejectPendingRequest(
            id,
            new Error(
              `Claude Code JSON-RPC request ${method} could not be sent: ${cause.message}`,
              {
                cause,
              },
            ),
          );
        });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.#sessionClient.sendJson({
      method,
      ...(params === undefined ? {} : { params }),
    });
  }

  #handleSessionEvent(event: SandboxSessionEvent): void {
    if (event.type === "response") {
      const pendingRequest = this.#pendingRequests.get(event.response.id);
      if (pendingRequest === undefined) {
        return;
      }
      this.#pendingRequests.delete(event.response.id);
      if (isErrorResponse(event.response)) {
        pendingRequest.reject(
          new ClaudeCodeJsonRpcRequestError({
            method: pendingRequest.method,
            id: event.response.id,
            code: event.response.error.code,
            message: event.response.error.message,
            ...("data" in event.response.error ? { data: event.response.error.data } : {}),
          }),
        );
        return;
      }
      pendingRequest.resolve(event.response.result);
      return;
    }

    if (event.type === "stream_reset") {
      this.#rejectAllPendingRequests(
        createStreamResetError({
          resetInfo: event.resetInfo,
          pendingMethods: [...this.#pendingRequests.values()].map((request) => request.method),
        }),
      );
    }
  }

  #rejectPendingRequest(id: JsonRpcId, error: Error): void {
    const pendingRequest = this.#pendingRequests.get(id);
    if (pendingRequest === undefined) {
      return;
    }
    this.#pendingRequests.delete(id);
    pendingRequest.reject(error);
  }

  #rejectAllPendingRequests(error: Error): void {
    for (const [id, pendingRequest] of this.#pendingRequests) {
      this.#pendingRequests.delete(id);
      pendingRequest.reject(error);
    }
  }
}
