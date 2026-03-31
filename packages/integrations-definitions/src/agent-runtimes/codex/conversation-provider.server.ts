import type {
  AgentConversationConnectInput,
  AgentConversationConnection,
  AgentConversationInspectResult,
  AgentConversationProvider,
} from "@mistle/integrations-core";
import { systemScheduler, type TimerHandle } from "@mistle/time";

import { CodexJsonRpcClient, CodexJsonRpcRequestError } from "./codex-json-rpc.js";
import {
  connectSandboxAgentConnection,
  type SandboxAgentConnection,
} from "./sandbox-agent-connection.server.js";

const CodexMethodNames = {
  THREAD_READ: "thread/read",
  THREAD_RESUME: "thread/resume",
  THREAD_START: "thread/start",
  TURN_START: "turn/start",
  TURN_STEER: "turn/steer",
} as const;

const ConversationProviderErrorCodes = {
  PROVIDER_CONVERSATION_MISSING: "provider_conversation_missing",
  PROVIDER_CREATE_CONVERSATION_FAILED: "provider_create_conversation_failed",
  PROVIDER_EXECUTION_MISSING: "provider_execution_missing",
  PROVIDER_INSPECT_FAILED: "provider_inspect_failed",
  PROVIDER_REQUEST_FAILED: "provider_request_failed",
  PROVIDER_RESUME_FAILED: "provider_resume_failed",
  PROVIDER_START_EXECUTION_FAILED: "provider_start_execution_failed",
  PROVIDER_STEER_EXECUTION_FAILED: "provider_steer_execution_failed",
} as const;

type ConversationProviderErrorCode =
  (typeof ConversationProviderErrorCodes)[keyof typeof ConversationProviderErrorCodes];

class ConversationProviderError extends Error {
  readonly code: ConversationProviderErrorCode;

  constructor(input: { code: ConversationProviderErrorCode; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

const CodexJsonRpcErrorCodes = {
  INVALID_REQUEST: -32600,
} as const;

const CodexJsonRpcRequestTimeoutMs = 60_000;

type CodexStartExecutionInputItem = {
  type: "text";
  text: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeThreadStatus(statusValue: unknown): AgentConversationInspectResult["status"] {
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

function missingInspectConversationOutput(): AgentConversationInspectResult {
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
  rpcClient: CodexJsonRpcClient,
  input: { method: string; params?: unknown },
): Promise<unknown> {
  const requestHandle = rpcClient.callWithHandle(input.method, input.params);
  return await withRequestTimeout(input.method, requestHandle).catch((error: unknown) => {
    if (error instanceof CodexJsonRpcRequestError) {
      const errorMessage = readJsonRpcErrorMessage(error);
      throw new ConversationProviderError({
        code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
        message: `Codex app-server request '${input.method}' failed (${String(error.code)}): ${errorMessage}`,
        cause: {
          method: error.method,
          errorCode: error.code,
          errorMessage,
          ...(error.data === undefined ? {} : { errorData: error.data }),
        },
      });
    }

    throw wrapProviderRequestFailure(input.method, error);
  });
}

async function initializeCodexSession(rpcClient: CodexJsonRpcClient): Promise<void> {
  const initializeHandle = rpcClient.callWithHandle("initialize", {
    clientInfo: CodexInitializeClientInfo,
  });
  const initializeResult = await withRequestTimeout("initialize", initializeHandle).catch(
    (error: unknown) => {
      throw wrapProviderRequestFailure("initialize", error);
    },
  );
  await rpcClient.notify("initialized", {});
  if (!isRecord(initializeResult) || typeof initializeResult.userAgent !== "string") {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
      message: "Codex initialize response did not include userAgent.",
    });
  }
}

function readJsonRpcErrorMessage(error: CodexJsonRpcRequestError): string {
  const prefix = `JSON-RPC request ${String(error.id)} failed with code ${String(error.code)}: `;
  return error.message.startsWith(prefix) ? error.message.slice(prefix.length) : error.message;
}

function wrapProviderRequestFailure(method: string, error: unknown): ConversationProviderError {
  if (error instanceof ConversationProviderError) {
    return error;
  }

  if (error instanceof CodexJsonRpcRequestError) {
    return new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
      message: `Codex app-server request '${method}' failed (${String(error.code)}): ${readJsonRpcErrorMessage(error)}`,
      cause: {
        method: error.method,
        errorCode: error.code,
        errorMessage: readJsonRpcErrorMessage(error),
        ...(error.data === undefined ? {} : { errorData: error.data }),
      },
    });
  }

  return new ConversationProviderError({
    code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
    message:
      error instanceof Error
        ? error.message
        : `Codex app-server request '${method}' failed with a non-error exception.`,
    cause: error,
  });
}

async function withRequestTimeout<T>(
  method: string,
  handle: { promise: Promise<T>; cancel: (error?: Error) => void },
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout: TimerHandle = systemScheduler.schedule(() => {
      if (settled) {
        return;
      }
      settled = true;
      handle.cancel(
        new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
          message: `Timed out waiting ${String(CodexJsonRpcRequestTimeoutMs)}ms for Codex app-server request '${method}'.`,
        }),
      );
      reject(
        new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_REQUEST_FAILED,
          message: `Timed out waiting ${String(CodexJsonRpcRequestTimeoutMs)}ms for Codex app-server request '${method}'.`,
        }),
      );
    }, CodexJsonRpcRequestTimeoutMs);

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      systemScheduler.cancel(timeout);
      callback();
    };

    void handle.promise.then(
      (value) => {
        settle(() => resolve(value));
      },
      (error: unknown) => {
        settle(() => reject(error));
      },
    );
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

function resolveCodexStartThreadParams(options: Readonly<Record<string, unknown>> | undefined): {
  model?: string;
} {
  if (options === undefined || !("model" in options) || options.model === undefined) {
    return {};
  }

  const modelValue = options.model;
  if (typeof modelValue !== "string" || modelValue.trim().length === 0) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: "Codex createAutomationConversation options.model must be a non-empty string.",
    });
  }

  return {
    model: modelValue.trim(),
  };
}

async function createProviderConnection(
  input: AgentConversationConnectInput,
): Promise<AgentConversationConnection> {
  const connectInput: {
    connectionUrl: string;
    connectTimeoutMs?: number;
  } = {
    connectionUrl: input.connectionUrl,
  };
  if (input.connectTimeoutMs !== undefined) {
    connectInput.connectTimeoutMs = input.connectTimeoutMs;
  }
  const connection = await connectSandboxAgentConnection(connectInput);
  return await initializeProviderConnection(connection);
}

async function initializeProviderConnection(
  connection: SandboxAgentConnection,
): Promise<AgentConversationConnection> {
  try {
    const rpcClient = new CodexJsonRpcClient(connection.sessionClient);

    await initializeCodexSession(rpcClient);

    return {
      request: async (requestInput) => {
        return await sendJsonRpcRequest(rpcClient, requestInput);
      },
      close: async () => {
        rpcClient.dispose();
        await connection.close();
      },
    };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

export function createOpenAiConversationProvider(): AgentConversationProvider {
  return {
    connect: createProviderConnection,
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
      let createResult: unknown;
      try {
        createResult = await input.connection.request({
          method: CodexMethodNames.THREAD_START,
          params: resolveCodexStartThreadParams(input.options),
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
        if (isProviderConversationMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex resume conversation failed with non-error exception.",
            cause: error,
          });
        }
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
        if (isProviderConversationMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex start execution failed with non-error exception.",
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

      return {
        providerExecutionId: extractTurnStartExecutionId(startResult),
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
        if (isProviderConversationMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex steer execution failed with non-error exception.",
            cause: error,
          });
        }
        if (isProviderExecutionMissingError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING,
            message:
              error instanceof Error
                ? error.message
                : "Codex steer execution failed with non-error exception.",
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

      return {
        providerExecutionId: extractTurnSteerExecutionId(steerResult),
      };
    },
  };
}
