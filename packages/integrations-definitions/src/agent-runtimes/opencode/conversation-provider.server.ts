import type {
  AgentConversationConnectInput,
  AgentConversationConnection,
  AgentConversationProvider,
} from "@mistle/integrations-core";

import {
  connectSandboxAgentConnection,
  type SandboxAgentConnection,
} from "../codex/sandbox-agent-connection.server.js";
import { OpencodeBridgeClient, OpencodeBridgeRequestError } from "./bridge-client.js";
import {
  type OpencodeBridgeConversationCreateResult,
  OpencodeBridgeConversationCreateResultSchema,
  type OpencodeBridgeConversationInspectResult,
  OpencodeBridgeConversationInspectResultSchema,
  type OpencodeBridgeExecutionResult,
  OpencodeBridgeExecutionResultSchema,
  OpencodeBridgeMethodNames,
} from "./bridge-protocol.js";

const ConversationProviderErrorCodes = {
  PROVIDER_CONVERSATION_MISSING: "provider_conversation_missing",
  PROVIDER_CREATE_CONVERSATION_FAILED: "provider_create_conversation_failed",
  PROVIDER_EXECUTION_MISSING: "provider_execution_missing",
  PROVIDER_INSPECT_FAILED: "provider_inspect_failed",
  PROVIDER_INTERRUPT_EXECUTION_FAILED: "provider_interrupt_execution_failed",
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

function buildMissingConversationMessage(providerConversationId: string): string {
  return `OpenCode conversation '${providerConversationId}' was not found.`;
}

function isMissingConversationError(error: unknown): boolean {
  if (!(error instanceof OpencodeBridgeRequestError)) {
    return false;
  }
  if (error.code !== -32000) {
    return false;
  }
  if (typeof error.data !== "object" || error.data === null || Array.isArray(error.data)) {
    return false;
  }
  if (!("status" in error.data)) {
    return false;
  }

  return error.data.status === 404;
}

function parseInspectResult(result: unknown): OpencodeBridgeConversationInspectResult {
  const parsedResult = OpencodeBridgeConversationInspectResultSchema.safeParse(result);
  if (!parsedResult.success) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
      message: `OpenCode inspect response payload is invalid. Payload: ${JSON.stringify(result)}`,
    });
  }

  return parsedResult.data;
}

function parseCreateConversationResult(result: unknown): OpencodeBridgeConversationCreateResult {
  const parsedResult = OpencodeBridgeConversationCreateResultSchema.safeParse(result);
  if (!parsedResult.success) {
    throw new ConversationProviderError({
      code: ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
      message: `OpenCode create response payload is invalid. Payload: ${JSON.stringify(result)}`,
    });
  }

  return parsedResult.data;
}

function parseExecutionResult(
  result: unknown,
  code: ConversationProviderErrorCode,
): OpencodeBridgeExecutionResult {
  const parsedResult = OpencodeBridgeExecutionResultSchema.safeParse(result);
  if (!parsedResult.success) {
    throw new ConversationProviderError({
      code,
      message: `OpenCode execution response payload is invalid. Payload: ${JSON.stringify(result)}`,
    });
  }

  return parsedResult.data;
}

function createConversationProviderError(
  code: ConversationProviderErrorCode,
  fallbackMessage: string,
  error: unknown,
): ConversationProviderError {
  return new ConversationProviderError({
    code,
    message: error instanceof Error ? error.message : fallbackMessage,
    cause: error,
  });
}

async function inspectConversationOrThrow(input: {
  connection: AgentConversationConnection;
  providerConversationId: string;
}): Promise<OpencodeBridgeConversationInspectResult> {
  try {
    const inspectResult = await input.connection.request({
      method: OpencodeBridgeMethodNames.CONVERSATION_INSPECT,
      params: {
        providerConversationId: input.providerConversationId,
      },
    });

    return parseInspectResult(inspectResult);
  } catch (error) {
    if (isMissingConversationError(error)) {
      throw new ConversationProviderError({
        code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
        message: buildMissingConversationMessage(input.providerConversationId),
        cause: error,
      });
    }

    throw createConversationProviderError(
      ConversationProviderErrorCodes.PROVIDER_INSPECT_FAILED,
      "OpenCode inspect failed with non-error exception.",
      error,
    );
  }
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
  return createBridgeConnection(connection);
}

function createBridgeConnection(connection: SandboxAgentConnection): AgentConversationConnection {
  const bridgeClient = new OpencodeBridgeClient(connection.sessionClient);

  return {
    request: async (requestInput) =>
      await bridgeClient.call(requestInput.method, requestInput.params),
    close: async () => {
      bridgeClient.dispose();
      await connection.close();
    },
  };
}

export function createOpencodeConversationProvider(): AgentConversationProvider {
  return {
    connect: createProviderConnection,
    inspectConversation: async (input) =>
      await inspectConversationOrThrow({
        connection: input.connection,
        providerConversationId: input.providerConversationId,
      }),
    createConversation: async (input) => {
      try {
        const createResult = await input.connection.request({
          method: OpencodeBridgeMethodNames.CONVERSATION_CREATE,
          ...(input.options === undefined ? {} : { params: { options: input.options } }),
        });
        const parsedCreateResult = parseCreateConversationResult(createResult);

        return {
          providerConversationId: parsedCreateResult.providerConversationId,
          ...(parsedCreateResult.providerState === undefined
            ? {}
            : { providerState: parsedCreateResult.providerState }),
        };
      } catch (error) {
        throw createConversationProviderError(
          ConversationProviderErrorCodes.PROVIDER_CREATE_CONVERSATION_FAILED,
          "OpenCode create conversation failed with non-error exception.",
          error,
        );
      }
    },
    resumeConversation: async (input) => {
      try {
        await input.connection.request({
          method: OpencodeBridgeMethodNames.CONVERSATION_RESUME,
          params: {
            providerConversationId: input.providerConversationId,
          },
        });
      } catch (error) {
        if (isMissingConversationError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message: buildMissingConversationMessage(input.providerConversationId),
            cause: error,
          });
        }

        throw createConversationProviderError(
          ConversationProviderErrorCodes.PROVIDER_RESUME_FAILED,
          "OpenCode resume conversation failed with non-error exception.",
          error,
        );
      }
    },
    startExecution: async (input) => {
      try {
        const startResult = await input.connection.request({
          method: OpencodeBridgeMethodNames.EXECUTION_START,
          params: {
            providerConversationId: input.providerConversationId,
            inputText: input.inputText,
          },
        });
        const parsedStartResult = parseExecutionResult(
          startResult,
          ConversationProviderErrorCodes.PROVIDER_START_EXECUTION_FAILED,
        );

        return {
          providerExecutionId: parsedStartResult.providerExecutionId,
        };
      } catch (error) {
        if (isMissingConversationError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message: buildMissingConversationMessage(input.providerConversationId),
            cause: error,
          });
        }

        throw createConversationProviderError(
          ConversationProviderErrorCodes.PROVIDER_START_EXECUTION_FAILED,
          "OpenCode start execution failed with non-error exception.",
          error,
        );
      }
    },
    steerExecution: async (input) => {
      const parsedInspectResult = await inspectConversationOrThrow({
        connection: input.connection,
        providerConversationId: input.providerConversationId,
      });
      if (!parsedInspectResult.exists) {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
          message: `OpenCode conversation '${input.providerConversationId}' does not exist.`,
        });
      }
      if (parsedInspectResult.status !== "active") {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING,
          message: `OpenCode conversation '${input.providerConversationId}' has no active turn to steer.`,
        });
      }

      try {
        const steerResult = await input.connection.request({
          method: OpencodeBridgeMethodNames.EXECUTION_STEER,
          params: {
            providerConversationId: input.providerConversationId,
            providerExecutionId: input.providerExecutionId,
            inputText: input.inputText,
          },
        });
        const parsedSteerResult = parseExecutionResult(
          steerResult,
          ConversationProviderErrorCodes.PROVIDER_STEER_EXECUTION_FAILED,
        );

        return {
          providerExecutionId: parsedSteerResult.providerExecutionId,
        };
      } catch (error) {
        if (isMissingConversationError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message: buildMissingConversationMessage(input.providerConversationId),
            cause: error,
          });
        }

        throw createConversationProviderError(
          ConversationProviderErrorCodes.PROVIDER_STEER_EXECUTION_FAILED,
          "OpenCode steer execution failed with non-error exception.",
          error,
        );
      }
    },
    interruptExecution: async (input) => {
      const parsedInspectResult = await inspectConversationOrThrow({
        connection: input.connection,
        providerConversationId: input.providerConversationId,
      });
      if (!parsedInspectResult.exists) {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
          message: `OpenCode conversation '${input.providerConversationId}' does not exist.`,
        });
      }
      if (parsedInspectResult.status !== "active") {
        throw new ConversationProviderError({
          code: ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING,
          message: `OpenCode conversation '${input.providerConversationId}' has no active turn to interrupt.`,
        });
      }

      try {
        await input.connection.request({
          method: OpencodeBridgeMethodNames.EXECUTION_INTERRUPT,
          params: {
            providerConversationId: input.providerConversationId,
            providerExecutionId: input.providerExecutionId,
          },
        });
      } catch (error) {
        if (isMissingConversationError(error)) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_CONVERSATION_MISSING,
            message: buildMissingConversationMessage(input.providerConversationId),
            cause: error,
          });
        }

        throw createConversationProviderError(
          ConversationProviderErrorCodes.PROVIDER_INTERRUPT_EXECUTION_FAILED,
          "OpenCode interrupt execution failed with non-error exception.",
          error,
        );
      }
    },
  };
}
