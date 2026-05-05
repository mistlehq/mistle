import { extractActiveW3cTraceCarrier } from "@mistle/telemetry/trace-context.js";

import {
  AutomationConversationExecutionActions,
  AutomationConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveAutomationConversationExecutionAction,
  resolveAutomationConversationSteerRecoveryAction,
} from "./automation-conversation-delivery.js";
import {
  type ConversationProviderAdapter,
  type ProviderConnection,
  getConversationProviderAdapter,
} from "./provider-adapter.js";
import {
  type ExecutedConversationProviderDelivery,
  type ExecuteConversationProviderDeliveryInput,
} from "./types.js";

class ConversationDeliveryExecutionError extends Error {}

const DeliveryContextNotificationMethod = "mistle/setDeliveryContext";
const ProviderDeliveryAttemptLimit = 2;

class RecoverableProviderSetupError extends Error {
  readonly originalError: unknown;

  constructor(error: unknown) {
    super(
      error instanceof Error ? error.message : "Provider setup failed with a recoverable error.",
      {
        cause: error,
      },
    );
    this.originalError = error;
  }
}

type DeliveryTraceCarrier = {
  traceparent: string;
  tracestate?: string;
  baggage?: string;
};

type DeliveryContextNotificationParams =
  ExecuteConversationProviderDeliveryInput["deliveryContext"] & DeliveryTraceCarrier;

function readActiveDeliveryTraceCarrier(): DeliveryTraceCarrier {
  const activeTraceCarrier = extractActiveW3cTraceCarrier();
  if (activeTraceCarrier === null) {
    throw new ConversationDeliveryExecutionError(
      "Automation conversation delivery requires an active OpenTelemetry trace context before sending delivery context to Codex proxy.",
    );
  }
  return activeTraceCarrier;
}

export function resolveDeliveryContextNotificationParams(
  deliveryContext: ExecuteConversationProviderDeliveryInput["deliveryContext"],
): DeliveryContextNotificationParams {
  return {
    ...deliveryContext,
    ...readActiveDeliveryTraceCarrier(),
  };
}

function hasErrorCause(input: unknown): input is { cause: unknown } {
  return typeof input === "object" && input !== null && "cause" in input;
}

function readErrorMessage(input: unknown): string | null {
  if (input instanceof Error) {
    return input.message;
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "message" in input &&
    typeof input.message === "string"
  ) {
    return input.message;
  }
  return null;
}

function isSandboxAgentStreamUnavailableError(input: unknown): boolean {
  let current: unknown = input;
  for (let depth = 0; depth < 8; depth += 1) {
    const message = readErrorMessage(current);
    if (
      message !== null &&
      (message.includes("Sandbox session stream is not open.") ||
        message.includes("Sandbox session stream reset") ||
        message.includes("Sandbox session transport is not connected.") ||
        message.includes("Sandbox websocket connection failed.") ||
        message.includes("Sandbox websocket connection closed before it opened.") ||
        message.includes("Sandbox websocket connection closed."))
    ) {
      return true;
    }

    if (!hasErrorCause(current)) {
      return false;
    }
    current = current.cause;
  }
  return false;
}

async function steerConversationExecution(input: {
  adapter: ConversationProviderAdapter;
  connection: ProviderConnection;
  conversationId: string;
  runtimeId: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
  inputText: string;
}) {
  if (input.providerConversationId === null) {
    throw new ConversationDeliveryExecutionError(
      `AutomationConversation '${input.conversationId}' is missing provider conversation id while attempting to steer execution.`,
    );
  }
  if (input.providerExecutionId === null) {
    throw new ConversationDeliveryExecutionError(
      `AutomationConversation '${input.conversationId}' is missing provider execution id while attempting to steer execution.`,
    );
  }

  return input.adapter.steerExecution({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
    providerExecutionId: input.providerExecutionId,
    inputText: input.inputText,
  });
}

async function recoverLateSteerExecution(input: {
  adapter: ConversationProviderAdapter;
  connection: ProviderConnection;
  conversationId: string;
  providerConversationId: string;
  providerExecutionId: string;
  inputText: string;
  collaborationModeSettings?: ExecuteConversationProviderDeliveryInput["collaborationModeSettings"];
}) {
  if (input.adapter.recoverLateSteer !== undefined) {
    return await input.adapter.recoverLateSteer({
      connection: input.connection,
      providerConversationId: input.providerConversationId,
      providerExecutionId: input.providerExecutionId,
      inputText: input.inputText,
    });
  }

  const inspectResult = await input.adapter.inspectAutomationConversation({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
  });
  const recoveryAction = resolveAutomationConversationSteerRecoveryAction({
    inspectAutomationConversation: inspectResult,
  });

  switch (recoveryAction) {
    case AutomationConversationSteerRecoveryActions.START:
      return input.adapter.startExecution({
        connection: input.connection,
        providerConversationId: input.providerConversationId,
        inputText: input.inputText,
        collaborationModeSettings: input.collaborationModeSettings,
      });
    case AutomationConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.conversationId}' references missing provider conversation '${input.providerConversationId}' after steer reported no active turn.`,
      );
    case AutomationConversationSteerRecoveryActions.FAIL_NOT_LOADED:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.conversationId}' provider conversation '${input.providerConversationId}' remained not loaded after steer reported no active turn.`,
      );
    case AutomationConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.conversationId}' provider conversation '${input.providerConversationId}' is in error state after steer reported no active turn.`,
      );
    case AutomationConversationSteerRecoveryActions.FAIL_STILL_ACTIVE:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.conversationId}' provider conversation '${input.providerConversationId}' is still active after steer reported no active turn.`,
      );
  }
}

async function executeConversationProviderDeliveryAttempt(
  adapter: ConversationProviderAdapter,
  input: ExecuteConversationProviderDeliveryInput,
): Promise<ExecutedConversationProviderDelivery> {
  let connection: ProviderConnection | null = null;
  let providerConversationId = input.providerConversationId;
  let didAttemptProviderExecution = false;

  try {
    connection = await adapter.connect({
      connectionUrl: input.connectionUrl,
    });

    if (connection.notify === undefined) {
      throw new ConversationDeliveryExecutionError(
        `Agent runtime '${input.runtimeId}' does not support sending delivery context notifications before conversation delivery.`,
      );
    }

    await connection.notify({
      method: DeliveryContextNotificationMethod,
      params: resolveDeliveryContextNotificationParams(input.deliveryContext),
    });

    let createdConversationState: unknown;
    if (providerConversationId === null) {
      const createdConversation = await adapter.createAutomationConversation({
        connection,
      });
      providerConversationId = createdConversation.providerConversationId;
      createdConversationState = createdConversation.providerState;
    }

    let inspectResult = await adapter.inspectAutomationConversation({
      connection,
      providerConversationId,
    });
    if (inspectResult.exists && inspectResult.status === "not_loaded") {
      await adapter.resumeAutomationConversation({
        connection,
        providerConversationId,
      });
      inspectResult = await adapter.inspectAutomationConversation({
        connection,
        providerConversationId,
      });
    }
    const executionAction = resolveAutomationConversationExecutionAction({
      inspectAutomationConversation: inspectResult,
      providerExecutionId: input.providerExecutionId,
      adapter,
    });

    let executionUpdate;
    switch (executionAction) {
      case AutomationConversationExecutionActions.START:
        didAttemptProviderExecution = true;
        executionUpdate = await adapter.startExecution({
          connection,
          providerConversationId,
          inputText: input.inputText,
          collaborationModeSettings: input.collaborationModeSettings,
        });
        break;
      case AutomationConversationExecutionActions.STEER:
        if (input.providerExecutionId === null) {
          throw new ConversationDeliveryExecutionError(
            `AutomationConversation '${input.conversationId}' is missing provider execution id while attempting late steer recovery.`,
          );
        }

        try {
          didAttemptProviderExecution = true;
          executionUpdate = await steerConversationExecution({
            adapter,
            connection,
            conversationId: input.conversationId,
            runtimeId: input.runtimeId,
            providerConversationId,
            providerExecutionId: input.providerExecutionId,
            inputText: input.inputText,
          });
        } catch (error) {
          if (!isRecoverableLateSteerError({ error })) {
            throw error;
          }

          executionUpdate = await recoverLateSteerExecution({
            adapter,
            connection,
            conversationId: input.conversationId,
            providerConversationId,
            providerExecutionId: input.providerExecutionId,
            inputText: input.inputText,
            collaborationModeSettings: input.collaborationModeSettings,
          });
        }
        break;
      case AutomationConversationExecutionActions.FAIL_MISSING_CONVERSATION:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.conversationId}' references missing provider conversation '${providerConversationId}'.`,
        );
      case AutomationConversationExecutionActions.FAIL_NOT_LOADED:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.conversationId}' provider conversation '${providerConversationId}' remained not loaded after resume.`,
        );
      case AutomationConversationExecutionActions.FAIL_PROVIDER_ERROR:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.conversationId}' provider conversation '${providerConversationId}' is in error state.`,
        );
      case AutomationConversationExecutionActions.FAIL_MISSING_EXECUTION:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.conversationId}' is missing provider execution id while provider conversation '${providerConversationId}' is active.`,
        );
    }

    return {
      providerConversationId,
      providerExecutionId: executionUpdate.providerExecutionId,
      providerState: executionUpdate.providerState ?? createdConversationState,
    };
  } catch (error) {
    if (
      providerConversationId === null &&
      !didAttemptProviderExecution &&
      isSandboxAgentStreamUnavailableError(error)
    ) {
      throw new RecoverableProviderSetupError(error);
    }
    throw error;
  } finally {
    await connection?.close();
  }
}

export async function executeConversationProviderDelivery(
  input: ExecuteConversationProviderDeliveryInput,
): Promise<ExecutedConversationProviderDelivery> {
  const adapter = getConversationProviderAdapter(input.runtimeId);

  for (let attempt = 1; attempt <= ProviderDeliveryAttemptLimit; attempt += 1) {
    try {
      return await executeConversationProviderDeliveryAttempt(adapter, input);
    } catch (error) {
      if (!(error instanceof RecoverableProviderSetupError)) {
        throw error;
      }
      if (attempt === ProviderDeliveryAttemptLimit) {
        throw error.originalError;
      }
    }
  }

  throw new ConversationDeliveryExecutionError(
    "Automation conversation delivery exhausted provider setup attempts.",
  );
}
