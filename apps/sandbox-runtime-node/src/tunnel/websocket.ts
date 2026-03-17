import WebSocket, { type RawData } from "ws";

import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";

const WebSocketCloseTimeoutMs = 1_000;

function toMessageData(data: RawData, isBinary: boolean): string | Uint8Array {
  if (!isBinary) {
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(data));
    }
    if (Buffer.isBuffer(data)) {
      return data.toString("utf8");
    }

    return Buffer.concat(data).toString("utf8");
  }

  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }

  return new Uint8Array(Buffer.concat(data));
}

export class WebSocketClosedError extends Error {
  readonly code: number;
  readonly reason: string;

  constructor(code: number, reason: string) {
    super(`websocket closed with code ${String(code)}${reason.length === 0 ? "" : `: ${reason}`}`);
    this.code = code;
    this.reason = reason;
  }
}

export function isExpectedWebSocketClose(error: unknown): boolean {
  if (error instanceof WebSocketClosedError) {
    return error.code === 1000 || error.code === 1001;
  }

  return false;
}

export function connectWebSocket(url: string, signal: AbortSignal): Promise<WebSocket> {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url);

    const cleanup = (): void => {
      socket.off("open", handleOpen);
      socket.off("error", handleError);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = (): void => {
      cleanup();
      socket.terminate();
      reject(signal.reason ?? new Error("websocket connection was aborted"));
    };
    const handleOpen = (): void => {
      cleanup();
      resolve(socket);
    };
    const handleError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    socket.once("open", handleOpen);
    socket.once("error", handleError);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

export function closeWebSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(forceCloseTimer);
      socket.off("close", finish);
      socket.off("error", finish);
      resolve();
    };

    const forceCloseTimer = setTimeout(() => {
      socket.terminate();
    }, WebSocketCloseTimeoutMs);

    socket.once("close", finish);
    socket.once("error", finish);
    socket.close();
  });
}

export function sendWebSocketMessage(
  socket: WebSocket,
  message: TunnelSocketMessage,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.send(
      message.payload,
      { binary: message.kind === "binary" },
      (error: Error | null | undefined) => {
        if (error == null) {
          resolve();
          return;
        }

        reject(error);
      },
    );
  });
}

export function createWebSocketMessageQueue(socket: WebSocket): AsyncQueue<TunnelSocketMessage> {
  const queue = new AsyncQueue<TunnelSocketMessage>();

  socket.on("message", (data: RawData, isBinary: boolean) => {
    const payload = toMessageData(data, isBinary);
    queue.push(
      typeof payload === "string"
        ? {
            kind: "text",
            payload,
          }
        : {
            kind: "binary",
            payload,
          },
    );
  });
  socket.once("error", (error: Error) => {
    queue.fail(error);
  });
  socket.once("close", (code: number, reason: Buffer) => {
    queue.fail(new WebSocketClosedError(code, reason.toString("utf8")));
  });

  return queue;
}
