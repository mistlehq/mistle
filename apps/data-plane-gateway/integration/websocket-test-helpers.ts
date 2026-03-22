import WebSocket, { type RawData } from "ws";

const ConnectTimeoutMs = 4_000;
const scheduleTimeout = globalThis.setTimeout.bind(globalThis);
const cancelTimeout = globalThis.clearTimeout.bind(globalThis);
type UnexpectedResponse = {
  statusCode?: number;
};

export type FailedWebSocketConnectResult = {
  error: unknown;
  responseStatusCode: number | undefined;
};

export type WebSocketConnectOptions = {
  autoPong?: boolean;
  handshakeTimeoutMs?: number;
};

export type SandboxTunnelWebSocketTokenKind = "bootstrap" | "connect";

function createWebSocketClientOptions(input: WebSocketConnectOptions | undefined): {
  autoPong?: boolean;
  handshakeTimeout: number;
} {
  return input?.autoPong === undefined
    ? {
        handshakeTimeout: input?.handshakeTimeoutMs ?? ConnectTimeoutMs,
      }
    : {
        autoPong: input.autoPong,
        handshakeTimeout: input.handshakeTimeoutMs ?? ConnectTimeoutMs,
      };
}

export function connectWebSocket(
  url: string,
  options?: WebSocketConnectOptions,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, createWebSocketClientOptions(options));

    const onOpen = (): void => {
      socket.off("error", onError);
      socket.off("unexpected-response", onUnexpectedResponse);
      resolve(socket);
    };

    const onError = (error: Error): void => {
      socket.off("open", onOpen);
      socket.off("unexpected-response", onUnexpectedResponse);
      reject(error);
    };

    const onUnexpectedResponse = (_request: unknown, response: UnexpectedResponse): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      reject(
        Object.assign(new Error("Websocket upgrade failed."), {
          statusCode: response.statusCode,
        }),
      );
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("unexpected-response", onUnexpectedResponse);
  });
}

export function connectSandboxTunnelWebSocket(input: {
  websocketBaseUrl: string;
  sandboxInstanceId: string;
  tokenKind: SandboxTunnelWebSocketTokenKind;
  token: string;
  autoPong?: boolean;
}): Promise<WebSocket> {
  const tokenQueryParam = input.tokenKind === "bootstrap" ? "bootstrap_token" : "connect_token";

  return connectWebSocket(
    `${input.websocketBaseUrl}/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}?${tokenQueryParam}=${encodeURIComponent(input.token)}`,
    input.autoPong === undefined
      ? undefined
      : {
          autoPong: input.autoPong,
        },
  );
}

export function connectWebSocketExpectFailure(url: string): Promise<FailedWebSocketConnectResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      url,
      createWebSocketClientOptions({
        handshakeTimeoutMs: ConnectTimeoutMs,
      }),
    );

    socket.once("open", () => {
      socket.close();
      reject(new Error("Expected websocket connection to fail but it opened successfully."));
    });

    socket.once("unexpected-response", (_request: unknown, response: UnexpectedResponse) => {
      resolve({
        error: new Error("Websocket upgrade failed."),
        responseStatusCode: response.statusCode,
      });
    });

    socket.once("error", (error: Error) => {
      resolve({
        error,
        responseStatusCode: undefined,
      });
    });
  });
}

export function closeWebSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("close", () => {
      resolve();
    });
    socket.once("error", (error: Error) => {
      reject(error);
    });

    socket.close();
  });
}

export type WebSocketCloseEvent = {
  code: number;
  reason: string;
};

export function waitForWebSocketClose(socket: WebSocket): Promise<WebSocketCloseEvent> {
  return new Promise((resolve, reject) => {
    const onClose = (code: number, reason: Buffer): void => {
      cleanup();
      resolve({
        code,
        reason: reason.toString("utf8"),
      });
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      socket.off("close", onClose);
      socket.off("error", onError);
    };

    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

export type ReceivedWebSocketMessage = {
  data: string | Buffer;
  isBinary: boolean;
};

export function waitForWebSocketMessage(socket: WebSocket): Promise<ReceivedWebSocketMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: RawData, isBinary: boolean): void => {
      cleanup();
      resolve({
        data: isBinary ? toBuffer(data) : toBuffer(data).toString("utf8"),
        isBinary,
      });
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

export function waitForNoWebSocketMessage(socket: WebSocket, timeoutMs = 150): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (): void => {
      cleanup();
      reject(new Error("Expected no websocket message."));
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      cancelTimeout(timeoutHandle);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };

    const timeoutHandle = scheduleTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

export function sendWebSocketMessage(socket: WebSocket, payload: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.send(payload, (error) => {
      if (error == null) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

export function sendWebSocketPingAndExpectPong(socket: WebSocket, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      socket.off("pong", onPong);
      socket.off("error", onError);
    };

    const onPong = (data: Buffer): void => {
      cleanup();
      if (!data.equals(payload)) {
        reject(new Error("Websocket pong payload mismatch."));
        return;
      }
      resolve();
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.once("pong", onPong);
    socket.once("error", onError);
    socket.ping(payload, undefined, (error) => {
      if (error == null) {
        return;
      }

      cleanup();
      reject(error);
    });
  });
}
