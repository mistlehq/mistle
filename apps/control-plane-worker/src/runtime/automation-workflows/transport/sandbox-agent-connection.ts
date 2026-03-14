import { randomInt } from "node:crypto";

import {
  encodeDataFrame,
  PayloadKindWebSocketText,
  type StreamOpen,
  type StreamOpenError,
  type StreamOpenOK,
} from "@mistle/sandbox-session-protocol";
import { systemScheduler } from "@mistle/time";
import WebSocket, { type RawData } from "ws";

const DefaultConnectTimeoutMs = 15_000;
const DefaultCloseCode = 1000;
const DefaultCloseReason = "automation payload delivered";

type StreamOpenControlMessage = StreamOpenOK | StreamOpenError;

export type ConnectSandboxAgentConnectionInput = {
  connectionUrl: string;
  connectTimeoutMs?: number;
};

export type CloseSandboxAgentConnectionInput = {
  code?: number;
  reason?: string;
};

export type SandboxAgentConnection = {
  streamId: number;
  socket: WebSocket;
  sendText: (message: string) => Promise<void>;
  close: (input?: CloseSandboxAgentConnectionInput) => Promise<void>;
};

export type SendSandboxAgentMessageInput = {
  connection: SandboxAgentConnection;
  message: string;
  autoClose?: boolean;
};

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function parseStreamOpenControlMessage(data: RawData): StreamOpenControlMessage | null {
  const rawPayload = toBuffer(data).toString("utf8");

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawPayload);
  } catch {
    return null;
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    return null;
  }

  if (!("type" in parsedPayload) || !("streamId" in parsedPayload)) {
    return null;
  }

  const typeValue = parsedPayload.type;
  const streamIdValue = readPositiveInteger(parsedPayload.streamId);
  if (typeof typeValue !== "string" || streamIdValue === null) {
    return null;
  }

  if (typeValue === "stream.open.ok") {
    return {
      type: "stream.open.ok",
      streamId: streamIdValue,
    };
  }

  if (typeValue === "stream.open.error") {
    if (!("code" in parsedPayload) || !("message" in parsedPayload)) {
      return null;
    }

    const codeValue = parsedPayload.code;
    const messageValue = parsedPayload.message;
    if (typeof codeValue !== "string" || typeof messageValue !== "string") {
      return null;
    }

    return {
      type: "stream.open.error",
      streamId: streamIdValue,
      code: codeValue,
      message: messageValue,
    };
  }

  return null;
}

function sendTextFrame(socket: WebSocket, payload: string): Promise<void> {
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

function sendAgentTextDataFrame(
  socket: WebSocket,
  streamId: number,
  payload: string,
): Promise<void> {
  const encodedPayload = encodeDataFrame({
    streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: new TextEncoder().encode(payload),
  });

  return new Promise((resolve, reject) => {
    socket.send(encodedPayload, (error) => {
      if (error == null) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

function closeSocket(socket: WebSocket, input?: CloseSandboxAgentConnectionInput): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onClose = (): void => {
      cleanup();
      resolve();
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

    if (socket.readyState === WebSocket.CLOSING) {
      return;
    }

    socket.close(input?.code ?? DefaultCloseCode, input?.reason ?? DefaultCloseReason);
  });
}

export async function connectSandboxAgentConnection(
  input: ConnectSandboxAgentConnectionInput,
): Promise<SandboxAgentConnection> {
  const streamId = randomInt(1, 0x7fff_ffff);
  const connectTimeoutMs = input.connectTimeoutMs ?? DefaultConnectTimeoutMs;
  const socket = new WebSocket(input.connectionUrl, {
    handshakeTimeout: connectTimeoutMs,
  });

  const openMessage: StreamOpen = {
    type: "stream.open",
    streamId,
    channel: {
      kind: "agent",
    },
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const connectTimeout = systemScheduler.schedule(() => {
      fail(
        new Error(
          `Timed out waiting for sandbox agent stream.open acknowledgement after ${String(connectTimeoutMs)}ms.`,
        ),
      );
    }, connectTimeoutMs);

    function cleanup(): void {
      systemScheduler.cancel(connectTimeout);
      socket.off("open", handleOpen);
      socket.off("message", handleMessage);
      socket.off("error", handleError);
      socket.off("close", handleClose);
    }

    function fail(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.terminate();
      reject(error);
    }

    function succeed(): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve();
    }

    function handleOpen(): void {
      const openPayload = JSON.stringify(openMessage);
      void sendTextFrame(socket, openPayload).catch((error: unknown) => {
        if (error instanceof Error) {
          fail(error);
          return;
        }

        fail(new Error("Failed to send sandbox agent stream.open request."));
      });
    }

    function handleMessage(data: RawData): void {
      const controlMessage = parseStreamOpenControlMessage(data);
      if (controlMessage === null) {
        return;
      }
      if (controlMessage.streamId !== streamId) {
        return;
      }

      if (controlMessage.type === "stream.open.ok") {
        succeed();
        return;
      }

      fail(
        new Error(
          `Sandbox agent stream.open request was rejected (${controlMessage.code}): ${controlMessage.message}`,
        ),
      );
    }

    function handleError(error: Error): void {
      fail(error);
    }

    function handleClose(): void {
      fail(new Error("Sandbox agent websocket closed before stream.open acknowledgement."));
    }

    socket.on("open", handleOpen);
    socket.on("message", handleMessage);
    socket.on("error", handleError);
    socket.on("close", handleClose);
  });

  return {
    streamId,
    socket,
    sendText: async (message) => sendAgentTextDataFrame(socket, streamId, message),
    close: async (closeInput) => closeSocket(socket, closeInput),
  };
}

export async function sendSandboxAgentMessage(input: SendSandboxAgentMessageInput): Promise<void> {
  try {
    await input.connection.sendText(input.message);
  } finally {
    if (input.autoClose !== false) {
      await input.connection.close();
    }
  }
}
