import { extractActiveW3cTraceCarrier } from "@mistle/telemetry/trace-context.js";

import { getConversationProviderAdapter } from "./provider-adapter.js";
import {
  TriggerConversationExecutionActions,
  TriggerConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveTriggerConversationExecutionAction,
  resolveTriggerConversationSteerRecoveryAction,
} from "./trigger-conversation-delivery.js";
import {
  type ExecutedConversationProviderDelivery,
  type ExecuteConversationProviderDeliveryInput,
} from "./types.js";

class ConversationDeliveryExecutionError extends Error {}

const DeliveryContextNotificationMethod = "mistle/setDeliveryContext";

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
      "Trigger conversation delivery requires an active OpenTelemetry trace context before sending delivery context to Codex proxy.",
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

async function steerConversationExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  conversationId: string;
  runtimeId: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
  inputText: string;
}) {
  if (input.providerConversationId === null) {
    throw new ConversationDeliveryExecutionError(
      `TriggerConversation '${input.conversationId}' is missing provider conversation id while attempting to steer execution.`,
    );
  }
  if (input.providerExecutionId === null) {
    throw new ConversationDeliveryExecutionError(
      `TriggerConversation '${input.conversationId}' is missing provider execution id while attempting to steer execution.`,
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
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
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

  const inspectResult = await input.adapter.inspectTriggerConversation({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
  });
  const recoveryAction = resolveTriggerConversationSteerRecoveryAction({
    inspectTriggerConversation: inspectResult,
  });

  switch (recoveryAction) {
    case TriggerConversationSteerRecoveryActions.START:
      return input.adapter.startExecution({
        connection: input.connection,
        providerConversationId: input.providerConversationId,
        inputText: input.inputText,
        collaborationModeSettings: input.collaborationModeSettings,
      });
    case TriggerConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION:
      throw new ConversationDeliveryExecutionError(
        `TriggerConversation '${input.conversationId}' references missing provider conversation '${input.providerConversationId}' after steer reported no active turn.`,
      );
    case TriggerConversationSteerRecoveryActions.FAIL_NOT_LOADED:
      throw new ConversationDeliveryExecutionError(
        `TriggerConversation '${input.conversationId}' provider conversation '${input.providerConversationId}' remained not loaded after steer reported no active turn.`,
      );
    case TriggerConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR:
      throw new ConversationDeliveryExecutionError(
        `TriggerConversation '${input.conversationId}' provider conversation '${input.providerConversationId}' is in error state after steer reported no active turn.`,
      );
    case TriggerConversationSteerRecoveryActions.FAIL_STILL_ACTIVE:
      throw new ConversationDeliveryExecutionError(
        `TriggerConversation '${input.conversationId}' provider conversation '${input.providerConversationId}' is still active after steer reported no active turn.`,
      );
  }
}

export async function executeConversationProviderDelivery(
  input: ExecuteConversationProviderDeliveryInput,
): Promise<ExecutedConversationProviderDelivery> {
  const adapter = getConversationProviderAdapter(input.runtimeId);
  const connection = await adapter.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    if (connection.notify === undefined) {
      throw new ConversationDeliveryExecutionError(
        `Agent runtime '${input.runtimeId}' does not support sending delivery context notifications before conversation delivery.`,
      );
    }

    await connection.notify({
      method: DeliveryContextNotificationMethod,
      params: resolveDeliveryContextNotificationParams(input.deliveryContext),
    });

    let providerConversationId = input.providerConversationId;
    let createdConversationState: unknown;
    if (providerConversationId === null) {
      const createdConversation = await adapter.createTriggerConversation({
        connection,
        cwd: input.workingDirectory,
      });
      providerConversationId = createdConversation.providerConversationId;
      createdConversationState = createdConversation.providerState;
    }

    let inspectResult = await adapter.inspectTriggerConversation({
      connection,
      providerConversationId,
    });
    if (inspectResult.exists && inspectResult.status === "not_loaded") {
      await adapter.resumeTriggerConversation({
        connection,
        providerConversationId,
      });
      inspectResult = await adapter.inspectTriggerConversation({
        connection,
        providerConversationId,
      });
    }
    const executionAction = resolveTriggerConversationExecutionAction({
      inspectTriggerConversation: inspectResult,
      providerExecutionId: input.providerExecutionId,
      adapter,
    });

    let executionUpdate;
    switch (executionAction) {
      case TriggerConversationExecutionActions.START:
        executionUpdate = await adapter.startExecution({
          connection,
          providerConversationId,
          inputText: input.inputText,
          collaborationModeSettings: input.collaborationModeSettings,
        });
        break;
      case TriggerConversationExecutionActions.STEER:
        if (input.providerExecutionId === null) {
          throw new ConversationDeliveryExecutionError(
            `TriggerConversation '${input.conversationId}' is missing provider execution id while attempting late steer recovery.`,
          );
        }

        try {
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
      case TriggerConversationExecutionActions.FAIL_MISSING_CONVERSATION:
        throw new ConversationDeliveryExecutionError(
          `TriggerConversation '${input.conversationId}' references missing provider conversation '${providerConversationId}'.`,
        );
      case TriggerConversationExecutionActions.FAIL_NOT_LOADED:
        throw new ConversationDeliveryExecutionError(
          `TriggerConversation '${input.conversationId}' provider conversation '${providerConversationId}' remained not loaded after resume.`,
        );
      case TriggerConversationExecutionActions.FAIL_PROVIDER_ERROR:
        throw new ConversationDeliveryExecutionError(
          `TriggerConversation '${input.conversationId}' provider conversation '${providerConversationId}' is in error state.`,
        );
      case TriggerConversationExecutionActions.FAIL_MISSING_EXECUTION:
        throw new ConversationDeliveryExecutionError(
          `TriggerConversation '${input.conversationId}' is missing provider execution id while provider conversation '${providerConversationId}' is active.`,
        );
    }

    return {
      providerConversationId,
      providerExecutionId: executionUpdate.providerExecutionId,
      providerState: executionUpdate.providerState ?? createdConversationState,
    };
  } finally {
    await connection.close();
  }
}
