import WebSocket, { type RawData } from "ws";

const ConnectTimeoutMs = 4_000;
type UnexpectedResponse = {
  statusCode?: number;
};

export type FailedWebSocketConnectResult = {
  error: unknown;
  responseStatusCode: number | undefined;
};

export function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      handshakeTimeout: ConnectTimeoutMs,
    });

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

export function connectWebSocketExpectFailure(url: string): Promise<FailedWebSocketConnectResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      handshakeTimeout: ConnectTimeoutMs,
    });

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
