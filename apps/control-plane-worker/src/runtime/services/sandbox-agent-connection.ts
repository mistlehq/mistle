import { randomUUID } from "node:crypto";

import { systemScheduler } from "@mistle/time";
import WebSocket, { type RawData } from "ws";

const DefaultConnectTimeoutMs = 15_000;
const DefaultCloseCode = 1000;
const DefaultCloseReason = "automation payload delivered";

type ConnectOkControlMessage = {
  type: "connect.ok";
  requestId: string;
};

type ConnectErrorControlMessage = {
  type: "connect.error";
  requestId: string;
  code: string;
  message: string;
};

type ConnectControlMessage = ConnectOkControlMessage | ConnectErrorControlMessage;

type AgentConnectRequest = {
  type: "connect";
  v: 1;
  requestId: string;
  channel: {
    kind: "agent";
  };
};

export type ConnectSandboxAgentConnectionInput = {
  connectionUrl: string;
  requestId?: string;
  connectTimeoutMs?: number;
};

export type CloseSandboxAgentConnectionInput = {
  code?: number;
  reason?: string;
};

export type SandboxAgentConnection = {
  requestId: string;
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

function parseConnectControlMessage(data: RawData): ConnectControlMessage | null {
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

  if (!("type" in parsedPayload) || !("requestId" in parsedPayload)) {
    return null;
  }

  const typeValue = parsedPayload.type;
  const requestIdValue = parsedPayload.requestId;
  if (typeof typeValue !== "string" || typeof requestIdValue !== "string") {
    return null;
  }

  if (typeValue === "connect.ok") {
    return {
      type: "connect.ok",
      requestId: requestIdValue,
    };
  }

  if (typeValue === "connect.error") {
    if (!("code" in parsedPayload) || !("message" in parsedPayload)) {
      return null;
    }

    const codeValue = parsedPayload.code;
    const messageValue = parsedPayload.message;
    if (typeof codeValue !== "string" || typeof messageValue !== "string") {
      return null;
    }

    return {
      type: "connect.error",
      requestId: requestIdValue,
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
  const requestId = input.requestId ?? randomUUID();
  const connectTimeoutMs = input.connectTimeoutMs ?? DefaultConnectTimeoutMs;
  const socket = new WebSocket(input.connectionUrl, {
    handshakeTimeout: connectTimeoutMs,
  });

  const agentConnectRequest: AgentConnectRequest = {
    type: "connect",
    v: 1,
    requestId,
    channel: {
      kind: "agent",
    },
  };

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const connectTimeout = systemScheduler.schedule(() => {
      fail(
        new Error(
          `Timed out waiting for sandbox agent connect acknowledgement after ${String(connectTimeoutMs)}ms.`,
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
      const connectRequestPayload = JSON.stringify(agentConnectRequest);
      void sendTextFrame(socket, connectRequestPayload).catch((error: unknown) => {
        if (error instanceof Error) {
          fail(error);
          return;
        }

        fail(new Error("Failed to send sandbox agent connect request."));
      });
    }

    function handleMessage(data: RawData): void {
      const controlMessage = parseConnectControlMessage(data);
      if (controlMessage === null) {
        return;
      }
      if (controlMessage.requestId !== requestId) {
        return;
      }

      if (controlMessage.type === "connect.ok") {
        succeed();
        return;
      }

      fail(
        new Error(
          `Sandbox agent connect request was rejected (${controlMessage.code}): ${controlMessage.message}`,
        ),
      );
    }

    function handleError(error: Error): void {
      fail(error);
    }

    function handleClose(): void {
      fail(new Error("Sandbox agent websocket closed before connect acknowledgement."));
    }

    socket.on("open", handleOpen);
    socket.on("message", handleMessage);
    socket.on("error", handleError);
    socket.on("close", handleClose);
  });

  return {
    requestId,
    socket,
    sendText: async (message) => sendTextFrame(socket, message),
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
