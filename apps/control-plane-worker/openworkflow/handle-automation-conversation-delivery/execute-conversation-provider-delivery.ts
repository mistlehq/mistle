import {
  AutomationConversationExecutionActions,
  AutomationConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveAutomationConversationExecutionAction,
  resolveAutomationConversationSteerRecoveryAction,
} from "./automation-conversation-delivery.js";
import { getConversationProviderAdapter } from "./provider-adapter.js";
import {
  type ExecutedConversationProviderDelivery,
  type ExecuteConversationProviderDeliveryInput,
} from "./types.js";

class ConversationDeliveryExecutionError extends Error {}

async function steerConversationExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  conversationId: string;
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
  if (input.adapter.steerExecution === undefined) {
    throw new ConversationDeliveryExecutionError(
      `AutomationConversation integration family does not support steering execution for conversation '${input.conversationId}'.`,
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
      });
    case AutomationConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.conversationId}' references missing provider conversation '${input.providerConversationId}' after steer reported no active turn.`,
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

export async function executeConversationProviderDelivery(
  input: ExecuteConversationProviderDeliveryInput,
): Promise<ExecutedConversationProviderDelivery> {
  const adapter = getConversationProviderAdapter(input.integrationFamilyId);
  const connection = await adapter.connect({
    connectionUrl: input.connectionUrl,
  });

  try {
    let providerConversationId = input.providerConversationId;
    let createdConversationState: unknown;
    if (providerConversationId === null) {
      const createdConversation = await adapter.createAutomationConversation({
        connection,
      });
      providerConversationId = createdConversation.providerConversationId;
      createdConversationState = createdConversation.providerState;
    }

    const inspectResult = await adapter.inspectAutomationConversation({
      connection,
      providerConversationId,
    });
    const executionAction = resolveAutomationConversationExecutionAction({
      inspectAutomationConversation: inspectResult,
      providerExecutionId: input.providerExecutionId,
      adapter,
    });

    let executionUpdate;
    switch (executionAction) {
      case AutomationConversationExecutionActions.START:
        executionUpdate = await adapter.startExecution({
          connection,
          providerConversationId,
          inputText: input.inputText,
        });
        break;
      case AutomationConversationExecutionActions.STEER:
        if (input.providerExecutionId === null) {
          throw new ConversationDeliveryExecutionError(
            `AutomationConversation '${input.conversationId}' is missing provider execution id while attempting late steer recovery.`,
          );
        }

        try {
          executionUpdate = await steerConversationExecution({
            adapter,
            connection,
            conversationId: input.conversationId,
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
          });
        }
        break;
      case AutomationConversationExecutionActions.FAIL_MISSING_CONVERSATION:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.conversationId}' references missing provider conversation '${providerConversationId}'.`,
        );
      case AutomationConversationExecutionActions.FAIL_PROVIDER_ERROR:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.conversationId}' provider conversation '${providerConversationId}' is in error state.`,
        );
      case AutomationConversationExecutionActions.FAIL_MISSING_EXECUTION:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.conversationId}' is missing provider execution id while provider conversation '${providerConversationId}' is active.`,
        );
      case AutomationConversationExecutionActions.FAIL_STEER_NOT_SUPPORTED:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation integration family '${input.integrationFamilyId}' does not support steering active execution for conversation '${input.conversationId}'.`,
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
