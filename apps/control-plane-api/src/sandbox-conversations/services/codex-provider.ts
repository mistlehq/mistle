import { randomUUID } from "node:crypto";

import { systemScheduler } from "@mistle/time";
import WebSocket, { type RawData } from "ws";

import { SandboxConversationsConflictCodes, SandboxConversationsConflictError } from "./errors.js";

const ConnectTimeoutMs = 15_000;
const JsonRpcTimeoutMs = 20_000;

type JsonRpcErrorPayload = {
  code?: number;
  message?: string;
  data?: unknown;
};

type JsonRpcResponsePayload = {
  id?: string | number;
  result?: unknown;
  error?: JsonRpcErrorPayload;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toUtf8(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function parseJsonRpcResponsePayload(data: RawData): JsonRpcResponsePayload | null {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(toUtf8(data));
  } catch {
    return null;
  }

  if (!isRecord(parsedPayload)) {
    return null;
  }

  const parsedResponse: JsonRpcResponsePayload = {};
  if (typeof parsedPayload.id === "string" || typeof parsedPayload.id === "number") {
    parsedResponse.id = parsedPayload.id;
  }
  if ("result" in parsedPayload) {
    parsedResponse.result = parsedPayload.result;
  }
  if (isRecord(parsedPayload.error)) {
    const parsedError: JsonRpcErrorPayload = {};
    if (typeof parsedPayload.error.code === "number") {
      parsedError.code = parsedPayload.error.code;
    }
    if (typeof parsedPayload.error.message === "string") {
      parsedError.message = parsedPayload.error.message;
    }
    if ("data" in parsedPayload.error) {
      parsedError.data = parsedPayload.error.data;
    }
    parsedResponse.error = parsedError;
  }

  return parsedResponse;
}

function readNestedValue(value: unknown, path: readonly string[]): unknown {
  let currentValue: unknown = value;
  for (const segment of path) {
    if (!isRecord(currentValue) || !(segment in currentValue)) {
      return null;
    }
    currentValue = currentValue[segment];
  }

  return currentValue;
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  const nestedValue = readNestedValue(value, path);
  return typeof nestedValue === "string" ? nestedValue : null;
}

function toRecoveryConflictError(
  message: string,
  cause?: unknown,
): SandboxConversationsConflictError {
  const detailedMessage =
    cause instanceof Error
      ? `${message} ${cause.message}`
      : cause === undefined
        ? message
        : message;

  return new SandboxConversationsConflictError(
    SandboxConversationsConflictCodes.CONVERSATION_RECOVERY_FAILED,
    detailedMessage,
  );
}

async function connectAgentSocket(connectionUrl: string): Promise<WebSocket> {
  const requestId = randomUUID();
  const socket = new WebSocket(connectionUrl, {
    handshakeTimeout: ConnectTimeoutMs,
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const timeoutId = systemScheduler.schedule(() => {
      fail(new Error("Timed out waiting for sandbox agent connect acknowledgement."));
    }, ConnectTimeoutMs);

    function cleanup(): void {
      systemScheduler.cancel(timeoutId);
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
      const connectPayload = {
        type: "connect",
        v: 1,
        requestId,
        channel: {
          kind: "agent",
        },
      };
      socket.send(JSON.stringify(connectPayload), (error: Error | undefined) => {
        if (error === undefined) {
          return;
        }

        fail(error);
      });
    }

    function handleMessage(data: RawData): void {
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(toUtf8(data));
      } catch {
        return;
      }
      if (!isRecord(parsedPayload)) {
        return;
      }

      if (parsedPayload.requestId !== requestId) {
        return;
      }
      if (parsedPayload.type === "connect.ok") {
        succeed();
        return;
      }
      if (parsedPayload.type === "connect.error") {
        const message =
          typeof parsedPayload.message === "string"
            ? parsedPayload.message
            : "Sandbox agent connection was rejected.";
        fail(new Error(message));
      }
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

  return socket;
}

async function sendJsonRpcRequest(
  socket: WebSocket,
  input: { method: string; params?: unknown },
): Promise<unknown> {
  const requestId = randomUUID();

  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;

    const timeoutId = systemScheduler.schedule(() => {
      fail(new Error(`Timed out waiting for JSON-RPC response for '${input.method}'.`));
    }, JsonRpcTimeoutMs);

    function cleanup(): void {
      systemScheduler.cancel(timeoutId);
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
      reject(error);
    }

    function succeed(value: unknown): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }

    function handleMessage(data: RawData): void {
      const parsedResponse = parseJsonRpcResponsePayload(data);
      if (parsedResponse === null || parsedResponse.id !== requestId) {
        return;
      }

      if (parsedResponse.error !== undefined) {
        const errorCode =
          parsedResponse.error.code === undefined
            ? "unknown_code"
            : String(parsedResponse.error.code);
        const errorMessage =
          parsedResponse.error.message === undefined
            ? "Provider request failed without an error message."
            : parsedResponse.error.message;
        fail(
          new Error(`Provider request '${input.method}' failed (${errorCode}): ${errorMessage}`),
        );
        return;
      }

      if (parsedResponse.result === undefined) {
        fail(new Error(`Provider request '${input.method}' did not include a result.`));
        return;
      }

      succeed(parsedResponse.result);
    }

    function handleError(error: Error): void {
      fail(error);
    }

    function handleClose(): void {
      fail(new Error(`Sandbox agent websocket closed during JSON-RPC request '${input.method}'.`));
    }

    socket.on("message", handleMessage);
    socket.on("error", handleError);
    socket.on("close", handleClose);

    const requestPayload =
      input.params === undefined
        ? {
            id: requestId,
            method: input.method,
          }
        : {
            id: requestId,
            method: input.method,
            params: input.params,
          };

    socket.send(JSON.stringify(requestPayload), (error: Error | undefined) => {
      if (error === undefined) {
        return;
      }

      fail(error);
    });
  });
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const timeoutId = systemScheduler.schedule(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    }, 1_000);

    socket.once("close", () => {
      if (settled) {
        return;
      }
      settled = true;
      systemScheduler.cancel(timeoutId);
      resolve();
    });

    if (socket.readyState !== WebSocket.CLOSING) {
      socket.close(1000, "conversation created");
    }
  });
}

export async function createCodexProviderConversation(input: {
  connectionUrl: string;
  model: string;
}): Promise<string> {
  const trimmedModel = input.model.trim();
  if (trimmedModel.length === 0) {
    throw toRecoveryConflictError("Codex conversation start requires a non-empty model.");
  }

  let socket: WebSocket | null = null;
  try {
    socket = await connectAgentSocket(input.connectionUrl);
    const createResult = await sendJsonRpcRequest(socket, {
      method: "thread/start",
      params: {
        options: {
          model: trimmedModel,
        },
      },
    });
    const providerConversationId =
      readNestedString(createResult, ["thread", "id"]) ?? readNestedString(createResult, ["id"]);
    if (providerConversationId === null || providerConversationId.length === 0) {
      throw toRecoveryConflictError("Codex thread/start response did not include thread.id.");
    }

    return providerConversationId;
  } catch (error) {
    if (error instanceof SandboxConversationsConflictError) {
      throw error;
    }

    throw toRecoveryConflictError("Failed to create Codex provider conversation.", error);
  } finally {
    if (socket !== null) {
      await closeSocket(socket);
    }
  }
}
