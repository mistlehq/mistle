import { createHash } from "node:crypto";

import type {
  AgentConversationIdempotencyMetadata,
  AgentConversationIdempotencyOperation,
} from "@mistle/integrations-core";

import type { ExecuteConversationProviderDeliveryInput } from "./types.js";

type RuntimeIdempotencyOperation = "create_conversation" | "submit_payload";

type RuntimeRequestFingerprintFieldValue = string | null;

type RuntimeRequestFingerprintFields = Record<string, RuntimeRequestFingerprintFieldValue>;

function resolveRuntimeIdempotencyOperation(
  operation: AgentConversationIdempotencyOperation,
): RuntimeIdempotencyOperation {
  switch (operation) {
    case "createConversation":
      return "create_conversation";
    case "submitPayload":
      return "submit_payload";
  }
}

function sortFingerprintFields(
  fields: RuntimeRequestFingerprintFields,
): RuntimeRequestFingerprintFields {
  const sortedFields: RuntimeRequestFingerprintFields = {};
  for (const key of Object.keys(fields).sort()) {
    sortedFields[key] = fields[key] ?? null;
  }
  return sortedFields;
}

function createRuntimeRequestFingerprint(input: {
  runtimeKey: string;
  operation: AgentConversationIdempotencyOperation;
  fields: RuntimeRequestFingerprintFields;
}): string {
  const payload = {
    version: 1,
    runtime_id: input.runtimeKey,
    operation: resolveRuntimeIdempotencyOperation(input.operation),
    fields: sortFingerprintFields(input.fields),
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `sha256:${digest}`;
}

function createProviderDeliveryIdempotencyMetadata(input: {
  runtimeKey: string;
  operation: AgentConversationIdempotencyOperation;
  keySuffix: "create-conversation" | "submit-payload";
  deliveryContext: ExecuteConversationProviderDeliveryInput["deliveryContext"];
  fields: RuntimeRequestFingerprintFields;
}): AgentConversationIdempotencyMetadata {
  return {
    key: `trigger-conversation-delivery:${input.deliveryContext.deliveryTaskId}:${input.keySuffix}`,
    operation: input.operation,
    requestFingerprint: createRuntimeRequestFingerprint({
      runtimeKey: input.runtimeKey,
      operation: input.operation,
      fields: input.fields,
    }),
  };
}

export function createConversationIdempotencyMetadata(
  input: ExecuteConversationProviderDeliveryInput,
): AgentConversationIdempotencyMetadata {
  return createProviderDeliveryIdempotencyMetadata({
    runtimeKey: input.conversationDeliveryPolicy.idempotencyFingerprintRuntimeKey,
    operation: "createConversation",
    keySuffix: "create-conversation",
    deliveryContext: input.deliveryContext,
    fields: createConversationFingerprintFields(input),
  });
}

export function submitPayloadIdempotencyMetadata(input: {
  deliveryInput: ExecuteConversationProviderDeliveryInput;
  providerConversationId: string;
}): AgentConversationIdempotencyMetadata {
  return createProviderDeliveryIdempotencyMetadata({
    runtimeKey: input.deliveryInput.conversationDeliveryPolicy.idempotencyFingerprintRuntimeKey,
    operation: "submitPayload",
    keySuffix: "submit-payload",
    deliveryContext: input.deliveryInput.deliveryContext,
    fields: submitPayloadFingerprintFields(input),
  });
}

function createConversationFingerprintFields(
  input: ExecuteConversationProviderDeliveryInput,
): RuntimeRequestFingerprintFields {
  const baseFields = {
    conversation_id: input.conversationId,
    delivery_task_id: input.deliveryContext.deliveryTaskId,
    working_directory: input.workingDirectory,
    trigger_run_id: input.deliveryContext.triggerRunId,
  };

  return baseFields;
}

function submitPayloadFingerprintFields(input: {
  deliveryInput: ExecuteConversationProviderDeliveryInput;
  providerConversationId: string;
}): RuntimeRequestFingerprintFields {
  const baseFields = {
    conversation_id: input.deliveryInput.conversationId,
    delivery_task_id: input.deliveryInput.deliveryContext.deliveryTaskId,
    input_text: input.deliveryInput.inputText,
    provider_conversation_id: input.providerConversationId,
    trigger_run_id: input.deliveryInput.deliveryContext.triggerRunId,
  };

  return baseFields;
}
