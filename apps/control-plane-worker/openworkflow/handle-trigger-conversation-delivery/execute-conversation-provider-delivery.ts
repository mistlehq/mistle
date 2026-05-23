import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import { extractActiveW3cTraceCarrier } from "@mistle/telemetry/trace-context.js";

import {
  createConversationIdempotencyMetadata,
  submitPayloadIdempotencyMetadata,
} from "./delivery-idempotency.js";
import {
  type ProviderInspectConversationOutput,
  getConversationProviderAdapter,
} from "./provider-adapter.js";
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

async function withConversationProviderDeliveryConnection<T>(
  input: ExecuteConversationProviderDeliveryInput,
  run: (
    adapter: ReturnType<typeof getConversationProviderAdapter>,
    connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>,
  ) => Promise<T>,
): Promise<T> {
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

    return await run(adapter, connection);
  } finally {
    await connection.close();
  }
}

async function steerConversationExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  conversationId: string;
  runtimeId: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
  inputText: string;
  idempotency: AgentConversationIdempotencyMetadata;
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
    idempotency: input.idempotency,
  });
}

async function recoverLateSteerExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  conversationId: string;
  providerConversationId: string;
  providerExecutionId: string;
  inputText: string;
  idempotency: AgentConversationIdempotencyMetadata;
  collaborationModeSettings?: ExecuteConversationProviderDeliveryInput["collaborationModeSettings"];
}) {
  if (input.adapter.recoverLateSteer !== undefined) {
    return await input.adapter.recoverLateSteer({
      connection: input.connection,
      providerConversationId: input.providerConversationId,
      providerExecutionId: input.providerExecutionId,
      inputText: input.inputText,
      idempotency: input.idempotency,
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
        idempotency: input.idempotency,
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

export async function createConversationProviderDeliveryConversation(
  input: ExecuteConversationProviderDeliveryInput,
): Promise<{
  providerConversationId: string;
  providerState?: unknown;
}> {
  if (input.providerConversationId !== null) {
    return {
      providerConversationId: input.providerConversationId,
    };
  }

  return await withConversationProviderDeliveryConnection(input, async (adapter, connection) => {
    const createdConversation = await adapter.createTriggerConversation({
      connection,
      cwd: input.workingDirectory,
      idempotency: createConversationIdempotencyMetadata(input),
    });

    return {
      providerConversationId: createdConversation.providerConversationId,
      providerState: createdConversation.providerState,
    };
  });
}

export async function inspectAndResumeConversationProviderDeliveryConversation(input: {
  deliveryInput: ExecuteConversationProviderDeliveryInput;
  providerConversationId: string;
}): Promise<ProviderInspectConversationOutput> {
  return await withConversationProviderDeliveryConnection(
    input.deliveryInput,
    async (adapter, connection) => {
      let inspectResult = await adapter.inspectTriggerConversation({
        connection,
        providerConversationId: input.providerConversationId,
      });
      if (inspectResult.exists && inspectResult.status === "not_loaded") {
        await adapter.resumeTriggerConversation({
          connection,
          providerConversationId: input.providerConversationId,
        });
        inspectResult = await adapter.inspectTriggerConversation({
          connection,
          providerConversationId: input.providerConversationId,
        });
      }

      return inspectResult;
    },
  );
}

export async function submitConversationProviderDeliveryPayload(input: {
  deliveryInput: ExecuteConversationProviderDeliveryInput;
  inspectTriggerConversation: ProviderInspectConversationOutput;
  providerConversationId: string;
}): Promise<{
  providerExecutionId: string | null;
  providerState?: unknown;
}> {
  return await withConversationProviderDeliveryConnection(
    input.deliveryInput,
    async (adapter, connection) => {
      const executionAction = resolveTriggerConversationExecutionAction({
        inspectTriggerConversation: input.inspectTriggerConversation,
        providerExecutionId: input.deliveryInput.providerExecutionId,
        adapter,
      });
      const submitIdempotency = submitPayloadIdempotencyMetadata({
        deliveryInput: input.deliveryInput,
        providerConversationId: input.providerConversationId,
      });

      switch (executionAction) {
        case TriggerConversationExecutionActions.START:
          return await adapter.startExecution({
            connection,
            providerConversationId: input.providerConversationId,
            inputText: input.deliveryInput.inputText,
            collaborationModeSettings: input.deliveryInput.collaborationModeSettings,
            idempotency: submitIdempotency,
          });
        case TriggerConversationExecutionActions.STEER:
          if (input.deliveryInput.providerExecutionId === null) {
            throw new ConversationDeliveryExecutionError(
              `TriggerConversation '${input.deliveryInput.conversationId}' is missing provider execution id while attempting late steer recovery.`,
            );
          }

          try {
            return await steerConversationExecution({
              adapter,
              connection,
              conversationId: input.deliveryInput.conversationId,
              runtimeId: input.deliveryInput.runtimeId,
              providerConversationId: input.providerConversationId,
              providerExecutionId: input.deliveryInput.providerExecutionId,
              inputText: input.deliveryInput.inputText,
              idempotency: submitIdempotency,
            });
          } catch (error) {
            if (!isRecoverableLateSteerError({ error })) {
              throw error;
            }

            return await recoverLateSteerExecution({
              adapter,
              connection,
              conversationId: input.deliveryInput.conversationId,
              providerConversationId: input.providerConversationId,
              providerExecutionId: input.deliveryInput.providerExecutionId,
              inputText: input.deliveryInput.inputText,
              idempotency: submitIdempotency,
              collaborationModeSettings: input.deliveryInput.collaborationModeSettings,
            });
          }
        case TriggerConversationExecutionActions.FAIL_MISSING_CONVERSATION:
          throw new ConversationDeliveryExecutionError(
            `TriggerConversation '${input.deliveryInput.conversationId}' references missing provider conversation '${input.providerConversationId}'.`,
          );
        case TriggerConversationExecutionActions.FAIL_NOT_LOADED:
          throw new ConversationDeliveryExecutionError(
            `TriggerConversation '${input.deliveryInput.conversationId}' provider conversation '${input.providerConversationId}' remained not loaded after resume.`,
          );
        case TriggerConversationExecutionActions.FAIL_PROVIDER_ERROR:
          throw new ConversationDeliveryExecutionError(
            `TriggerConversation '${input.deliveryInput.conversationId}' provider conversation '${input.providerConversationId}' is in error state.`,
          );
        case TriggerConversationExecutionActions.FAIL_MISSING_EXECUTION:
          throw new ConversationDeliveryExecutionError(
            `TriggerConversation '${input.deliveryInput.conversationId}' is missing provider execution id while provider conversation '${input.providerConversationId}' is active.`,
          );
      }
    },
  );
}

export async function executeConversationProviderDelivery(
  input: ExecuteConversationProviderDeliveryInput,
): Promise<ExecutedConversationProviderDelivery> {
  const createdConversation = await createConversationProviderDeliveryConversation(input);
  const inspectResult = await inspectAndResumeConversationProviderDeliveryConversation({
    deliveryInput: input,
    providerConversationId: createdConversation.providerConversationId,
  });
  const executionUpdate = await submitConversationProviderDeliveryPayload({
    deliveryInput: input,
    inspectTriggerConversation: inspectResult,
    providerConversationId: createdConversation.providerConversationId,
  });

  return {
    providerConversationId: createdConversation.providerConversationId,
    providerExecutionId: executionUpdate.providerExecutionId,
    providerState: executionUpdate.providerState ?? createdConversation.providerState,
  };
}
