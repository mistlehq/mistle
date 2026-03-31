import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcSuccessResponse,
  SandboxSessionClient,
  SandboxSessionEvent,
  SandboxSessionResetInfo,
} from "@mistle/sandbox-session-client";

type PendingRequest = {
  method: string;
  settled: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function createStreamResetError(resetInfo: SandboxSessionResetInfo): Error {
  return new Error(`Sandbox session stream reset (${resetInfo.code}): ${resetInfo.message}`);
}

function isErrorResponse(
  response: JsonRpcSuccessResponse | JsonRpcErrorResponse,
): response is JsonRpcErrorResponse {
  return "error" in response;
}

export class OpencodeBridgeRequestError extends Error {
  readonly method: string;
  readonly id: JsonRpcId;
  readonly code: number;
  readonly data?: unknown;

  constructor(input: {
    method: string;
    id: JsonRpcId;
    code: number;
    message: string;
    data?: unknown;
  }) {
    super(
      `OpenCode bridge request ${String(input.id)} failed with code ${String(input.code)}: ${input.message}`,
    );
    this.name = "OpencodeBridgeRequestError";
    this.method = input.method;
    this.id = input.id;
    this.code = input.code;
    if (input.data !== undefined) {
      this.data = input.data;
    }
  }
}

export class OpencodeBridgeClient {
  readonly #sessionClient: SandboxSessionClient;
  readonly #pendingRequests = new Map<JsonRpcId, PendingRequest>();
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
    this.#rejectAllPendingRequests(new Error("OpenCode bridge client disposed."));
  }

  async call(method: string, params?: unknown): Promise<unknown> {
    return await this.callWithHandle(method, params).promise;
  }

  callWithHandle(
    method: string,
    params?: unknown,
  ): {
    promise: Promise<unknown>;
    cancel: (error?: Error) => void;
  } {
    const id = this.#nextId;
    this.#nextId += 1;

    const promise = new Promise<unknown>((resolve, reject) => {
      this.#pendingRequests.set(id, {
        method,
        settled: false,
        resolve,
        reject,
      });

      void this.#sessionClient
        .sendJson({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params }),
        })
        .catch((error: unknown) => {
          this.#rejectPendingRequest(id, error instanceof Error ? error : new Error(String(error)));
        });
    });

    return {
      promise,
      cancel: (error) => {
        this.#rejectPendingRequest(
          id,
          error ?? new Error(`OpenCode bridge request ${String(id)} was canceled.`),
        );
      },
    };
  }

  #handleSessionEvent(event: SandboxSessionEvent): void {
    if (event.type === "response") {
      const pendingRequest = this.#pendingRequests.get(event.response.id);
      if (pendingRequest === undefined) {
        return;
      }

      this.#pendingRequests.delete(event.response.id);
      pendingRequest.settled = true;
      if (isErrorResponse(event.response)) {
        pendingRequest.reject(
          new OpencodeBridgeRequestError({
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
        new Error(event.errorMessage ?? "OpenCode bridge session connection ended."),
      );
      return;
    }

    if (event.type === "stream_reset") {
      this.#rejectAllPendingRequests(createStreamResetError(event.resetInfo));
    }
  }

  #rejectAllPendingRequests(error: Error): void {
    for (const pendingRequest of this.#pendingRequests.values()) {
      pendingRequest.settled = true;
      pendingRequest.reject(error);
    }
    this.#pendingRequests.clear();
  }

  #rejectPendingRequest(id: JsonRpcId, error: Error): void {
    const pendingRequest = this.#pendingRequests.get(id);
    if (pendingRequest === undefined || pendingRequest.settled) {
      return;
    }

    this.#pendingRequests.delete(id);
    pendingRequest.settled = true;
    pendingRequest.reject(error);
  }
}
