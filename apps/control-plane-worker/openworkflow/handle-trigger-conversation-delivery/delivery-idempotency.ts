import { createHash } from "node:crypto";

import type {
  AgentConversationIdempotencyMetadata,
  AgentConversationIdempotencyOperation,
} from "@mistle/integrations-core";

import type { ExecuteConversationProviderDeliveryInput } from "./types.js";

class DeliveryIdempotencyError extends Error {}

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

function resolveRuntimeIdempotencyRuntimeId(runtimeId: string): "codex" | "opencode" | "pi" {
  switch (runtimeId) {
    case "codex":
      return "codex";
    case "opencode":
      return "opencode";
    case "pi":
      return "pi";
    default:
      throw new DeliveryIdempotencyError(
        `Agent runtime '${runtimeId}' does not support delivery idempotency metadata.`,
      );
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
  runtimeId: string;
  operation: AgentConversationIdempotencyOperation;
  fields: RuntimeRequestFingerprintFields;
}): string {
  const payload = {
    version: 1,
    runtime_id: resolveRuntimeIdempotencyRuntimeId(input.runtimeId),
    operation: resolveRuntimeIdempotencyOperation(input.operation),
    fields: sortFingerprintFields(input.fields),
  };
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `sha256:${digest}`;
}

function createProviderDeliveryIdempotencyMetadata(input: {
  runtimeId: string;
  operation: AgentConversationIdempotencyOperation;
  keySuffix: "create-conversation" | "submit-payload";
  deliveryContext: ExecuteConversationProviderDeliveryInput["deliveryContext"];
  fields: RuntimeRequestFingerprintFields;
}): AgentConversationIdempotencyMetadata {
  return {
    key: `trigger-conversation-delivery:${input.deliveryContext.deliveryTaskId}:${input.keySuffix}`,
    operation: input.operation,
    requestFingerprint: createRuntimeRequestFingerprint({
      runtimeId: input.runtimeId,
      operation: input.operation,
      fields: input.fields,
    }),
  };
}

export function createConversationIdempotencyMetadata(
  input: ExecuteConversationProviderDeliveryInput,
): AgentConversationIdempotencyMetadata {
  return createProviderDeliveryIdempotencyMetadata({
    runtimeId: input.runtimeId,
    operation: "createConversation",
    keySuffix: "create-conversation",
    deliveryContext: input.deliveryContext,
    fields: {
      conversation_id: input.conversationId,
      delivery_task_id: input.deliveryContext.deliveryTaskId,
      trigger_run_id: input.deliveryContext.triggerRunId,
      working_directory: input.workingDirectory,
    },
  });
}

export function submitPayloadIdempotencyMetadata(input: {
  deliveryInput: ExecuteConversationProviderDeliveryInput;
  providerConversationId: string;
}): AgentConversationIdempotencyMetadata {
  return createProviderDeliveryIdempotencyMetadata({
    runtimeId: input.deliveryInput.runtimeId,
    operation: "submitPayload",
    keySuffix: "submit-payload",
    deliveryContext: input.deliveryInput.deliveryContext,
    fields: {
      conversation_id: input.deliveryInput.conversationId,
      delivery_task_id: input.deliveryInput.deliveryContext.deliveryTaskId,
      input_text: input.deliveryInput.inputText,
      provider_conversation_id: input.providerConversationId,
      trigger_run_id: input.deliveryInput.deliveryContext.triggerRunId,
    },
  });
}
