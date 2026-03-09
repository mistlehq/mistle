import { randomUUID } from "node:crypto";

import { systemScheduler, type TimerHandle } from "@mistle/time";
import WebSocket, { type RawData } from "ws";

import type {
  ConversationProviderAdapter,
  ProviderConnection,
  ProviderInspectConversationOutput,
} from "../../../agent-runtimes/conversation-provider-adapter.js";
import {
  ConversationProviderError,
  ConversationProviderErrorCodes,
} from "../../../agent-runtimes/conversation-provider-errors.js";
import {
  connectSandboxAgentConnection,
  type SandboxAgentConnection,
} from "../../../agent-runtimes/sandbox-agent-connection.js";
import { OpenAiDefaultCodexConversationProviderFamily } from "./agent-runtime-constants.js";

const CodexMethodNames = {
  THREAD_READ: "thread/read",
  THREAD_RESUME: "thread/resume",
  THREAD_START: "thread/start",
  TURN_START: "turn/start",
  TURN_STEER: "turn/steer",
} as const;

const CodexJsonRpcErrorCodes = {
  INVALID_REQUEST: -32600,
} as const;
const CodexJsonRpcRequestTimeoutMs = 60_000;

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

type CodexRequestFailureCause = {
  method: string;
  errorCode: number | null;
  errorMessage: string;
  errorData?: unknown;
};

const CodexInitializeClientInfo = {
  name: "mistle_control_plane_worker",
  title: "Mistle Control Plane Worker",
  version: "0.1.0",
} as const;

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
  if (!isRecord(statusValue) || typeof statusValue.type !== "string") {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
      message: "Codex inspect did not return thread.status.type.",
    });
  }

  switch (statusValue.type) {
    case "active":
      return "active";
    case "systemError":
      return "error";
    case "idle":
    case "notLoaded":
      return "idle";
    default:
      throw new ConversationProviderError({
        code: ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
        message: `Codex inspect returned unsupported thread status type '${statusValue.type}'.`,
      });
  }
}

function extractProviderConversationId(result: unknown): string {
  const providerConversationId = readNestedString(result, ["thread", "id"]);
  if (providerConversationId === null || providerConversationId.length === 0) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: "Codex thread/start response did not include thread.id.",
    });
  }

  return providerConversationId;
}

function extractTurnStartExecutionId(result: unknown): string {
  const providerExecutionId = readNestedString(result, ["turn", "id"]);
  if (providerExecutionId === null || providerExecutionId.length === 0) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_START_EXECUTION_FAILED,
      message: "Codex turn/start response did not include turn.id.",
    });
  }

  return providerExecutionId;
}

function extractTurnSteerExecutionId(result: unknown): string {
  const providerExecutionId = readNestedString(result, ["turnId"]);
  if (providerExecutionId === null || providerExecutionId.length === 0) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_STEER_EXECUTION_FAILED,
      message: "Codex turn/steer response did not include turnId.",
    });
  }

  return providerExecutionId;
}

function readCodexRequestFailureCause(error: unknown): CodexRequestFailureCause | null {
  if (!(error instanceof ConversationProviderError)) {
    return null;
  }
  if (error.code !== ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED) {
    return null;
  }

  if (!isRecord(error.cause)) {
    return null;
  }

  const methodValue = error.cause.method;
  const errorMessageValue = error.cause.errorMessage;
  const errorCodeValue = error.cause.errorCode;
  if (typeof methodValue !== "string") {
    return null;
  }
  if (typeof errorMessageValue !== "string") {
    return null;
  }
  if (errorCodeValue !== null && typeof errorCodeValue !== "number") {
    return null;
  }

  const cause: CodexRequestFailureCause = {
    method: methodValue,
    errorCode: errorCodeValue,
    errorMessage: errorMessageValue,
  };
  if ("errorData" in error.cause) {
    cause.errorData = error.cause.errorData;
  }

  return cause;
}

function isProviderConversationMissingError(error: unknown): boolean {
  const cause = readCodexRequestFailureCause(error);
  if (cause === null) {
    return false;
  }
  if (cause.errorCode !== CodexJsonRpcErrorCodes.INVALID_REQUEST) {
    return false;
  }

  if (cause.method === CodexMethodNames.THREAD_READ) {
    return cause.errorMessage.startsWith("invalid thread id:");
  }
  if (cause.method === CodexMethodNames.THREAD_RESUME) {
    return (
      cause.errorMessage.startsWith("invalid thread id:") ||
      cause.errorMessage.startsWith("thread not found:")
    );
  }
  if (
    cause.method === CodexMethodNames.TURN_START ||
    cause.method === CodexMethodNames.TURN_STEER
  ) {
    return (
      cause.errorMessage.startsWith("invalid thread id:") ||
      cause.errorMessage.startsWith("thread not found:")
    );
  }

  return false;
}

function isThreadReadNotLoadedError(error: unknown): boolean {
  const cause = readCodexRequestFailureCause(error);
  if (cause === null) {
    return false;
  }
  if (cause.method !== CodexMethodNames.THREAD_READ) {
    return false;
  }
  if (cause.errorCode !== CodexJsonRpcErrorCodes.INVALID_REQUEST) {
    return false;
  }

  return cause.errorMessage.startsWith("thread not loaded:");
}

function isThreadResumeNoRolloutError(error: unknown): boolean {
  const cause = readCodexRequestFailureCause(error);
  if (cause === null) {
    return false;
  }
  if (cause.method !== CodexMethodNames.THREAD_RESUME) {
    return false;
  }
  if (cause.errorCode !== CodexJsonRpcErrorCodes.INVALID_REQUEST) {
    return false;
  }

  return cause.errorMessage.startsWith("no rollout found for thread id ");
}

function missingInspectConversationOutput(): ProviderInspectConversationOutput {
  return {
    exists: false,
    status: "idle",
    activeExecutionId: null,
  };
}

function isProviderExecutionMissingError(error: unknown): boolean {
  const cause = readCodexRequestFailureCause(error);
  if (cause === null) {
    return false;
  }
  if (cause.method !== CodexMethodNames.TURN_STEER) {
    return false;
  }
  if (cause.errorCode !== CodexJsonRpcErrorCodes.INVALID_REQUEST) {
    return false;
  }

  return (
    cause.errorMessage === "no active turn to steer" ||
    cause.errorMessage.startsWith("expected active turn id `")
  );
}

async function sendJsonRpcRequest(
  connection: JsonRpcClientConnection,
  input: { method: string; params?: unknown },
): Promise<unknown> {
  const requestId = randomUUID();

  return await new Promise<unknown>((resolve, reject) => {
    const socket = connection.socket;
    let settled = false;
    const timeout: TimerHandle = systemScheduler.schedule(() => {
      fail(
        new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
          message: `Timed out waiting ${String(CodexJsonRpcRequestTimeoutMs)}ms for Codex app-server request '${input.method}'.`,
        }),
      );
    }, CodexJsonRpcRequestTimeoutMs);

    function cleanup(): void {
      systemScheduler.cancel(timeout);
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
        const rpcErrorCode = responsePayload.error.code ?? null;
        fail(
          new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
            message: `Codex app-server request '${input.method}' failed (${errorCode}): ${errorMessage}`,
            cause: {
              method: input.method,
              errorCode: rpcErrorCode,
              errorMessage,
              errorData: responsePayload.error.data,
            },
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

async function sendJsonRpcNotification(
  connection: JsonRpcClientConnection,
  input: { method: string; params?: unknown },
): Promise<void> {
  const requestPayload =
    input.params === undefined
      ? {
          method: input.method,
        }
      : {
          method: input.method,
          params: input.params,
        };
  try {
    await connection.sendText(JSON.stringify(requestPayload));
  } catch (error) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
      message: `Failed to send Codex app-server notification '${input.method}'.`,
      cause: error,
    });
  }
}

async function initializeCodexSession(connection: JsonRpcClientConnection): Promise<void> {
  const initializeResult = await sendJsonRpcRequest(connection, {
    method: "initialize",
    params: {
      clientInfo: CodexInitializeClientInfo,
    },
  });
  if (!isRecord(initializeResult) || typeof initializeResult.userAgent !== "string") {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
      message: "Codex initialize response did not include userAgent.",
    });
  }

  await sendJsonRpcNotification(connection, {
    method: "initialized",
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
  if (options === undefined || !("model" in options)) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: "Codex createConversation requires options.model.",
    });
  }

  const modelValue = options.model;
  if (typeof modelValue !== "string" || modelValue.trim().length === 0) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: "Codex createConversation options.model must be a non-empty string.",
    });
  }

  return modelValue.trim();
}

async function initializeProviderConnection(
  connection: SandboxAgentConnection,
): Promise<ProviderConnection> {
  try {
    const jsonRpcConnection: JsonRpcClientConnection = {
      socket: connection.socket,
      sendText: connection.sendText,
    };

    await initializeCodexSession(jsonRpcConnection);

    return {
      request: async (requestInput) => {
        return await sendJsonRpcRequest(jsonRpcConnection, requestInput);
      },
      close: async () => {
        await connection.close();
      },
    };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

export function createCodexConversationProviderAdapter(): ConversationProviderAdapter {
  return {
    providerFamily: OpenAiDefaultCodexConversationProviderFamily,
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
      return await initializeProviderConnection(connection);
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
          return missingInspectConversationOutput();
        }
        if (isThreadReadNotLoadedError(error)) {
          try {
            await input.connection.request({
              method: CodexMethodNames.THREAD_RESUME,
              params: {
                threadId: input.providerConversationId,
              },
            });
          } catch (resumeError) {
            if (
              isProviderConversationMissingError(resumeError) ||
              isThreadResumeNoRolloutError(resumeError)
            ) {
              return missingInspectConversationOutput();
            }
            throw new ConversationProviderError({
              code: ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
              message:
                resumeError instanceof Error
                  ? resumeError.message
                  : "Codex inspect failed with non-error exception while resuming thread.",
              cause: resumeError,
            });
          }

          try {
            inspectResult = await input.connection.request({
              method: CodexMethodNames.THREAD_READ,
              params: {
                threadId: input.providerConversationId,
              },
            });
          } catch (readAfterResumeError) {
            if (isProviderConversationMissingError(readAfterResumeError)) {
              return missingInspectConversationOutput();
            }
            throw new ConversationProviderError({
              code: ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
              message:
                readAfterResumeError instanceof Error
                  ? readAfterResumeError.message
                  : "Codex inspect failed with non-error exception after resuming thread.",
              cause: readAfterResumeError,
            });
          }
          return {
            exists: true,
            status: normalizeThreadStatus(readNestedValue(inspectResult, ["thread", "status"])),
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

      return {
        exists: true,
        status: normalizeThreadStatus(readNestedValue(inspectResult, ["thread", "status"])),
        activeExecutionId: null,
      };
    },
    createConversation: async (input) => {
      const model = resolveCodexModel(input.options);

      try {
        const result = await input.connection.request({
          method: CodexMethodNames.THREAD_START,
          params: {
            model,
          },
        });

        return {
          providerConversationId: extractProviderConversationId(result),
        };
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
        if (isProviderConversationMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex resume failed because the provider conversation is missing.",
            cause: error,
          });
        }

        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_RESUME_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex resume failed with non-error exception.",
          cause: error,
        });
      }
    },
    startExecution: async (input) => {
      try {
        const result = await input.connection.request({
          method: CodexMethodNames.TURN_START,
          params: {
            threadId: input.providerConversationId,
            input: toCodexTextInputItems(input.inputText),
          },
        });

        return {
          providerExecutionId: extractTurnStartExecutionId(result),
        };
      } catch (error) {
        if (isProviderConversationMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex start execution failed because the provider conversation is missing.",
            cause: error,
          });
        }

        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_START_EXECUTION_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex start execution failed with non-error exception.",
          cause: error,
        });
      }
    },
    steerExecution: async (input) => {
      try {
        const result = await input.connection.request({
          method: CodexMethodNames.TURN_STEER,
          params: {
            threadId: input.providerConversationId,
            turnId: input.providerExecutionId,
            input: toCodexTextInputItems(input.inputText),
          },
        });

        return {
          providerExecutionId: extractTurnSteerExecutionId(result),
        };
      } catch (error) {
        if (isProviderConversationMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex steer execution failed because the provider conversation is missing.",
            cause: error,
          });
        }
        if (isProviderExecutionMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex steer execution failed because the provider execution is missing.",
            cause: error,
          });
        }

        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_STEER_EXECUTION_FAILED,
          message:
            error instanceof Error
              ? error.message
              : "Codex steer execution failed with non-error exception.",
          cause: error,
        });
      }
    },
  };
}
