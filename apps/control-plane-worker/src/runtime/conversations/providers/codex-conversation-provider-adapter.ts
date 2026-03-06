import { randomUUID } from "node:crypto";

import WebSocket, { type RawData } from "ws";

import { connectSandboxAgentConnection } from "../../services/sandbox-agent-connection.js";
import type {
  ConversationProviderAdapter,
  ProviderConnection,
  ProviderInspectConversationOutput,
} from "../provider-adapter.js";
import {
  ConversationProviderError,
  ConversationProviderErrorCodes,
  type ConversationProviderErrorCode,
} from "../provider-errors.js";

const CodexMethodNames = {
  THREAD_READ: "thread/read",
  THREAD_RESUME: "thread/resume",
  THREAD_START: "thread/start",
  TURN_START: "turn/start",
  TURN_STEER: "turn/steer",
} as const;
const CodexModelOptionKey = "model";

export type CodexStartExecutionInputItem = {
  type: "text";
  text: string;
};

type JsonRpcErrorValue = {
  code?: number;
  message?: string;
  data?: unknown;
};

type JsonRpcResponsePayload = {
  id?: string | number;
  result?: unknown;
  error?: JsonRpcErrorValue;
};

type JsonRpcClientConnection = {
  socket: WebSocket;
  sendText: (payload: string) => Promise<void>;
};

function toText(data: RawData): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRpcResponsePayload(data: RawData): JsonRpcResponsePayload | null {
  const payloadText = toText(data);

  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payloadText);
  } catch {
    return null;
  }
  if (!isRecord(parsedPayload)) {
    return null;
  }

  let parsedError: JsonRpcErrorValue | undefined;
  if (isRecord(parsedPayload.error)) {
    parsedError = {};
    if ("data" in parsedPayload.error) {
      parsedError.data = parsedPayload.error.data;
    }
    if (typeof parsedPayload.error.code === "number") {
      parsedError.code = parsedPayload.error.code;
    }
    if (typeof parsedPayload.error.message === "string") {
      parsedError.message = parsedPayload.error.message;
    }
  }

  const responsePayload: JsonRpcResponsePayload = {
    result: parsedPayload.result,
  };
  if (typeof parsedPayload.id === "string" || typeof parsedPayload.id === "number") {
    responsePayload.id = parsedPayload.id;
  }
  if (parsedError !== undefined) {
    responsePayload.error = parsedError;
  }

  return responsePayload;
}

function readNestedString(value: unknown, path: readonly string[]): string | null {
  const nestedValue = readNestedValue(value, path);
  return typeof nestedValue === "string" ? nestedValue : null;
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

function normalizeThreadStatus(statusValue: unknown): ProviderInspectConversationOutput["status"] {
  if (typeof statusValue === "string") {
    const normalizedStatus = statusValue.toLowerCase().replaceAll("_", "").replaceAll("-", "");
    if (normalizedStatus.includes("active")) {
      return "active";
    }
    if (normalizedStatus.includes("systemerror") || normalizedStatus === "error") {
      return "error";
    }
    if (normalizedStatus.includes("idle") || normalizedStatus.includes("notloaded")) {
      return "idle";
    }
  }

  if (isRecord(statusValue)) {
    const typeValue = statusValue.type;
    if (typeof typeValue === "string") {
      return normalizeThreadStatus(typeValue);
    }
    const statusField = statusValue.status;
    if (typeof statusField === "string") {
      return normalizeThreadStatus(statusField);
    }
    const kindValue = statusValue.kind;
    if (typeof kindValue === "string") {
      return normalizeThreadStatus(kindValue);
    }
    const tagValue = statusValue.tag;
    if (typeof tagValue === "string") {
      return normalizeThreadStatus(tagValue);
    }
  }

  throw new ConversationProviderError({
    code: ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
    message: "Codex inspect did not return a recognized thread status shape.",
  });
}

function extractProviderConversationId(result: unknown): string {
  const providerConversationId =
    readNestedString(result, ["thread", "id"]) ?? readNestedString(result, ["id"]);
  if (providerConversationId === null || providerConversationId.length === 0) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: "Codex thread/start response did not include thread.id.",
    });
  }

  return providerConversationId;
}

function extractProviderExecutionId(
  result: unknown,
  failureCode: ConversationProviderErrorCode,
): string {
  const providerExecutionId =
    readNestedString(result, ["turn", "id"]) ?? readNestedString(result, ["id"]);
  if (providerExecutionId === null || providerExecutionId.length === 0) {
    throw new ConversationProviderError({
      code: failureCode,
      message: "Codex turn response did not include turn.id.",
    });
  }

  return providerExecutionId;
}

function isProviderConversationMissingError(error: unknown): boolean {
  if (!(error instanceof ConversationProviderError)) {
    return false;
  }
  if (error.code !== ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();
  return (
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("unknown thread") ||
    normalizedMessage.includes("no such thread")
  );
}

async function sendJsonRpcRequest(
  connection: JsonRpcClientConnection,
  input: { method: string; params?: unknown },
): Promise<unknown> {
  const requestId = randomUUID();

  return await new Promise<unknown>((resolve, reject) => {
    const socket = connection.socket;

    function cleanup(): void {
      socket.off("message", handleMessage);
      socket.off("error", handleError);
      socket.off("close", handleClose);
    }

    function fail(error: Error): void {
      cleanup();
      reject(error);
    }

    function succeed(value: unknown): void {
      cleanup();
      resolve(value);
    }

    function handleMessage(data: RawData): void {
      const responsePayload = parseJsonRpcResponsePayload(data);
      if (responsePayload === null) {
        return;
      }

      if (responsePayload.id !== requestId) {
        return;
      }

      if (responsePayload.error !== undefined) {
        const errorCode =
          responsePayload.error.code === undefined
            ? "unknown_code"
            : String(responsePayload.error.code);
        const errorMessage =
          responsePayload.error.message === undefined
            ? "Codex app-server JSON-RPC request failed without an error message."
            : responsePayload.error.message;
        fail(
          new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
            message: `Codex app-server request '${input.method}' failed (${errorCode}): ${errorMessage}`,
            cause: responsePayload.error.data,
          }),
        );
        return;
      }

      if (responsePayload.result === undefined) {
        fail(
          new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
            message: `Codex app-server request '${input.method}' did not return a JSON-RPC result.`,
          }),
        );
        return;
      }

      succeed(responsePayload.result);
    }

    function handleError(error: Error): void {
      fail(error);
    }

    function handleClose(): void {
      fail(new Error("Codex app-server websocket closed before JSON-RPC response."));
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
    void connection.sendText(JSON.stringify(requestPayload)).catch((error: unknown) => {
      fail(
        error instanceof Error
          ? error
          : new Error(`Failed to send Codex app-server request '${input.method}'.`),
      );
    });
  });
}

function toCodexTextInputItems(inputText: string): CodexStartExecutionInputItem[] {
  return [
    {
      type: "text",
      text: inputText,
    },
  ];
}

function resolveCodexModel(options: Record<string, unknown> | undefined): string {
  if (options === undefined || !(CodexModelOptionKey in options)) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: "Codex createConversation requires options.model.",
    });
  }

  const modelValue = options[CodexModelOptionKey];
  if (typeof modelValue !== "string" || modelValue.trim().length === 0) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: "Codex createConversation options.model must be a non-empty string.",
    });
  }

  return modelValue;
}

export function createCodexConversationProviderAdapter(): ConversationProviderAdapter {
  return {
    providerFamily: "codex",
    connect: async (input) => {
      const connectInput: {
        connectionUrl: string;
        requestId?: string;
        connectTimeoutMs?: number;
      } = {
        connectionUrl: input.connectionUrl,
      };
      if (input.requestId !== undefined) {
        connectInput.requestId = input.requestId;
      }
      if (input.connectTimeoutMs !== undefined) {
        connectInput.connectTimeoutMs = input.connectTimeoutMs;
      }
      const connection = await connectSandboxAgentConnection(connectInput);
      const jsonRpcConnection: JsonRpcClientConnection = {
        socket: connection.socket,
        sendText: connection.sendText,
      };

      const providerConnection: ProviderConnection = {
        request: async (requestInput) => {
          return await sendJsonRpcRequest(jsonRpcConnection, requestInput);
        },
        close: async () => {
          await connection.close();
        },
      };

      return providerConnection;
    },
    inspectConversation: async (input) => {
      let inspectResult: unknown;
      try {
        inspectResult = await input.connection.request({
          method: CodexMethodNames.THREAD_READ,
          params: {
            threadId: input.providerConversationId,
          },
        });
      } catch (error) {
        if (isProviderConversationMissingError(error)) {
          return {
            exists: false,
            status: "idle",
            activeExecutionId: null,
          };
        }
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex inspect failed with non-error exception.",
          cause: error,
        });
      }

      const threadStatusValue =
        readNestedValue(inspectResult, ["thread", "status"]) ??
        readNestedString(inspectResult, ["status"]) ??
        (isRecord(inspectResult) ? inspectResult.status : null);

      const activeExecutionId =
        readNestedString(inspectResult, ["thread", "activeTurnId"]) ??
        readNestedString(inspectResult, ["activeTurnId"]) ??
        null;

      return {
        exists: true,
        status: normalizeThreadStatus(threadStatusValue),
        activeExecutionId,
      };
    },
    createConversation: async (input) => {
      let createResult: unknown;
      try {
        createResult = await input.connection.request({
          method: CodexMethodNames.THREAD_START,
          params: {
            model: resolveCodexModel(input.options),
          },
        });
      } catch (error) {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex create conversation failed with non-error exception.",
          cause: error,
        });
      }

      return {
        providerConversationId: extractProviderConversationId(createResult),
      };
    },
    resumeConversation: async (input) => {
      try {
        await input.connection.request({
          method: CodexMethodNames.THREAD_RESUME,
          params: {
            threadId: input.providerConversationId,
          },
        });
      } catch (error) {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_RESUME_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex resume conversation failed with non-error exception.",
          cause: error,
        });
      }
    },
    startExecution: async (input) => {
      let startResult: unknown;
      try {
        startResult = await input.connection.request({
          method: CodexMethodNames.TURN_START,
          params: {
            threadId: input.providerConversationId,
            input: toCodexTextInputItems(input.inputText),
          },
        });
      } catch (error) {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_START_EXECUTION_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex start execution failed with non-error exception.",
          cause: error,
        });
      }

      return {
        providerExecutionId: extractProviderExecutionId(
          startResult,
          ConversationProviderErrorCodes.PROVIDER_START_EXECUTION_FAILED,
        ),
      };
    },
    steerExecution: async (input) => {
      let steerResult: unknown;
      try {
        steerResult = await input.connection.request({
          method: CodexMethodNames.TURN_STEER,
          params: {
            threadId: input.providerConversationId,
            input: toCodexTextInputItems(input.inputText),
            expectedTurnId: input.providerExecutionId,
          },
        });
      } catch (error) {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_STEER_EXECUTION_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex steer execution failed with non-error exception.",
          cause: error,
        });
      }

      return {
        providerExecutionId: extractProviderExecutionId(
          steerResult,
          ConversationProviderErrorCodes.PROVIDER_STEER_EXECUTION_FAILED,
        ),
      };
    },
  };
}
