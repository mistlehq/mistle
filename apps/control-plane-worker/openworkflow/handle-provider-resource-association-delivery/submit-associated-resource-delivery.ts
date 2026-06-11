import { createHash } from "node:crypto";

import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import { extractActiveW3cTraceCarrier } from "@mistle/telemetry/trace-context.js";

import {
  type ProviderInspectConversationOutput,
  getConversationProviderAdapter,
} from "../shared/provider-adapter.js";
import {
  isRecoverableLateSteerError,
  isStaleActiveTurnMismatchError,
} from "../shared/provider-errors.js";
import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

const DeliveryContextNotificationMethod = "mistle/setDeliveryContext";

export type ProviderResourceAssociationDeliveryInput = {
  runtimeId: string;
  connectionUrl: string;
  inputText: string;
  deliveryId: string;
  providerResourceAssociationId: string;
  sandboxInstanceId: string;
  sourceWebhookEventId: string;
  externalDeliveryId?: string | undefined;
};

type ProviderConnection = Awaited<
  ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>
>;

function resolveDeliveryContextNotificationParams(
  deliveryInput: ProviderResourceAssociationDeliveryInput,
): Record<string, string> {
  const traceCarrier = extractActiveW3cTraceCarrier();
  if (traceCarrier === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message:
        "Association delivery requires an active OpenTelemetry trace context before sending delivery context to the runtime provider.",
    });
  }

  return {
    source: "association",
    providerResourceAssociationId: deliveryInput.providerResourceAssociationId,
    associationDeliveryId: deliveryInput.deliveryId,
    webhookEventId: deliveryInput.sourceWebhookEventId,
    ...(deliveryInput.externalDeliveryId === undefined
      ? {}
      : { externalDeliveryId: deliveryInput.externalDeliveryId }),
    sandboxInstanceId: deliveryInput.sandboxInstanceId,
    ...traceCarrier,
  };
}

export async function submitAssociatedResourceDelivery(input: {
  deliveryInput: ProviderResourceAssociationDeliveryInput;
}): Promise<{
  providerConversationId: string;
  providerExecutionId: string;
}> {
  const adapter = getConversationProviderAdapter(input.deliveryInput.runtimeId);
  if (adapter.resolveOriginalConversation === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: `Agent runtime '${input.deliveryInput.runtimeId}' does not support resolving an original runtime conversation for associated-resource delivery.`,
    });
  }

  const connection = await adapter.connect({
    connectionUrl: input.deliveryInput.connectionUrl,
  });

  try {
    if (connection.notify !== undefined) {
      await connection.notify({
        method: DeliveryContextNotificationMethod,
        params: resolveDeliveryContextNotificationParams(input.deliveryInput),
      });
    }

    const originalConversation = await adapter.resolveOriginalConversation({
      connection,
    });
    if (originalConversation.providerConversationId === null) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_NOT_FOUND,
        message: `Associated sandbox runtime '${input.deliveryInput.runtimeId}' does not have an original runtime conversation.`,
      });
    }

    const providerConversationId = originalConversation.providerConversationId;
    const submitIdempotency = submitPayloadIdempotencyMetadata({
      deliveryInput: input.deliveryInput,
      providerConversationId,
    });

    if (adapter.submitAssociatedResourceDelivery !== undefined) {
      const result = await adapter.submitAssociatedResourceDelivery({
        connection,
        idempotency: submitIdempotency,
        inputText: input.deliveryInput.inputText,
        providerConversationId,
      });
      if (result.providerExecutionId === null) {
        throw new ProviderResourceAssociationDeliveryError({
          code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
          message: `Associated-resource delivery runtime '${input.deliveryInput.runtimeId}' did not return a provider execution id.`,
        });
      }

      return {
        providerConversationId,
        providerExecutionId: result.providerExecutionId,
      };
    }

    const inspectResult = await inspectAndResumeAssociatedResourceConversation({
      adapter,
      connection,
      providerConversationId,
    });
    const providerExecutionId = await submitAssociatedResourceDeliveryPayload({
      adapter,
      connection,
      deliveryInput: input.deliveryInput,
      inspectResult,
      submitIdempotency,
      providerConversationId,
    });

    return {
      providerConversationId,
      providerExecutionId,
    };
  } catch (error) {
    if (error instanceof ProviderResourceAssociationDeliveryError) {
      throw error;
    }

    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message:
        error instanceof Error
          ? error.message
          : "Associated-resource delivery failed with non-error exception.",
      cause: error,
    });
  } finally {
    await connection.close();
  }
}

async function inspectAndResumeAssociatedResourceConversation(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: ProviderConnection;
  providerConversationId: string;
}): Promise<ProviderInspectConversationOutput> {
  let inspectResult = await input.adapter.inspectTriggerConversation({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
  });
  if (inspectResult.exists && inspectResult.status === "not_loaded") {
    await input.adapter.resumeTriggerConversation({
      connection: input.connection,
      providerConversationId: input.providerConversationId,
    });
    inspectResult = await input.adapter.inspectTriggerConversation({
      connection: input.connection,
      providerConversationId: input.providerConversationId,
    });
  }

  return inspectResult;
}

async function submitAssociatedResourceDeliveryPayload(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: ProviderConnection;
  deliveryInput: ProviderResourceAssociationDeliveryInput;
  inspectResult: ProviderInspectConversationOutput;
  submitIdempotency: AgentConversationIdempotencyMetadata;
  providerConversationId: string;
}): Promise<string> {
  if (!input.inspectResult.exists) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_NOT_FOUND,
      message: `Associated-resource delivery references missing provider conversation '${input.providerConversationId}'.`,
    });
  }

  if (input.inspectResult.status === "not_loaded" || input.inspectResult.status === "error") {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: `Associated-resource delivery provider conversation '${input.providerConversationId}' is in '${input.inspectResult.status}' state.`,
    });
  }

  if (input.inspectResult.status === "idle") {
    return await startAssociatedResourceExecution({
      adapter: input.adapter,
      connection: input.connection,
      deliveryInput: input.deliveryInput,
      idempotency: input.submitIdempotency,
      providerConversationId: input.providerConversationId,
    });
  }

  if (input.inspectResult.activeExecutionId === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: `Associated-resource delivery provider conversation '${input.providerConversationId}' is active but did not report an active execution id.`,
    });
  }

  try {
    return await steerAssociatedResourceExecution({
      adapter: input.adapter,
      connection: input.connection,
      deliveryInput: input.deliveryInput,
      idempotency: input.submitIdempotency,
      providerConversationId: input.providerConversationId,
      providerExecutionId: input.inspectResult.activeExecutionId,
    });
  } catch (error) {
    if (!isRecoverableLateSteerError({ error }) && !isStaleActiveTurnMismatchError({ error })) {
      throw error;
    }

    return await recoverAssociatedResourceLateSteer({
      adapter: input.adapter,
      connection: input.connection,
      deliveryInput: input.deliveryInput,
      idempotency: input.submitIdempotency,
      providerConversationId: input.providerConversationId,
      providerExecutionId: input.inspectResult.activeExecutionId,
    });
  }
}

async function startAssociatedResourceExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: ProviderConnection;
  deliveryInput: ProviderResourceAssociationDeliveryInput;
  idempotency: AgentConversationIdempotencyMetadata;
  providerConversationId: string;
}): Promise<string> {
  const result = await input.adapter.startExecution({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
    inputText: input.deliveryInput.inputText,
    idempotency: input.idempotency,
  });
  if (result.providerExecutionId === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: `Associated-resource delivery runtime '${input.deliveryInput.runtimeId}' did not return a provider execution id.`,
    });
  }

  return result.providerExecutionId;
}

async function steerAssociatedResourceExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: ProviderConnection;
  deliveryInput: ProviderResourceAssociationDeliveryInput;
  idempotency: AgentConversationIdempotencyMetadata;
  providerConversationId: string;
  providerExecutionId: string;
}): Promise<string> {
  const result = await input.adapter.steerExecution({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
    providerExecutionId: input.providerExecutionId,
    inputText: input.deliveryInput.inputText,
    idempotency: input.idempotency,
  });

  return result.providerExecutionId;
}

async function recoverAssociatedResourceLateSteer(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: ProviderConnection;
  deliveryInput: ProviderResourceAssociationDeliveryInput;
  idempotency: AgentConversationIdempotencyMetadata;
  providerConversationId: string;
  providerExecutionId: string;
}): Promise<string> {
  if (input.adapter.recoverLateSteer !== undefined) {
    const result = await input.adapter.recoverLateSteer({
      connection: input.connection,
      providerConversationId: input.providerConversationId,
      providerExecutionId: input.providerExecutionId,
      inputText: input.deliveryInput.inputText,
      idempotency: input.idempotency,
    });
    if (result.providerExecutionId === null) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
        message: `Associated-resource delivery runtime '${input.deliveryInput.runtimeId}' did not return a provider execution id after late-steer recovery.`,
      });
    }

    return result.providerExecutionId;
  }

  const inspectResult = await input.adapter.inspectTriggerConversation({
    connection: input.connection,
    providerConversationId: input.providerConversationId,
  });
  if (inspectResult.status === "idle") {
    return await startAssociatedResourceExecution(input);
  }
  if (inspectResult.status === "active" && inspectResult.activeExecutionId !== null) {
    return await steerAssociatedResourceExecution({
      ...input,
      providerExecutionId: inspectResult.activeExecutionId,
    });
  }

  throw new ProviderResourceAssociationDeliveryError({
    code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
    message: `Associated-resource delivery could not recover late steer for provider conversation '${input.providerConversationId}'.`,
  });
}

function submitPayloadIdempotencyMetadata(input: {
  deliveryInput: ProviderResourceAssociationDeliveryInput;
  providerConversationId: string;
}): AgentConversationIdempotencyMetadata {
  return {
    key: `provider-resource-association-delivery:${input.deliveryInput.deliveryId}:submit-payload`,
    operation: "submitPayload",
    requestFingerprint: createSubmitPayloadRequestFingerprint({
      runtimeId: input.deliveryInput.runtimeId,
      fields: {
        delivery_task_id: input.deliveryInput.deliveryId,
        input_text: input.deliveryInput.inputText,
        provider_conversation_id: input.providerConversationId,
        provider_resource_association_id: input.deliveryInput.providerResourceAssociationId,
      },
    }),
  };
}

function createSubmitPayloadRequestFingerprint(input: {
  runtimeId: string;
  fields: Record<string, string | null>;
}): string {
  const payload = {
    version: 1,
    runtime_id: input.runtimeId,
    operation: "submit_payload",
    fields: sortFingerprintFields(input.fields),
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `sha256:${digest}`;
}

function sortFingerprintFields(
  fields: Record<string, string | null>,
): Record<string, string | null> {
  const sortedFields: Record<string, string | null> = {};
  for (const key of Object.keys(fields).sort()) {
    sortedFields[key] = fields[key] ?? null;
  }
  return sortedFields;
}
