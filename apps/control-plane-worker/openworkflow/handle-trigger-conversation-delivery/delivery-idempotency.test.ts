import { describe, expect, it } from "vitest";

import {
  createConversationIdempotencyMetadata,
  submitPayloadIdempotencyMetadata,
} from "./delivery-idempotency.js";
import type { ExecuteConversationProviderDeliveryInput } from "./types.js";

const DeliveryInput: ExecuteConversationProviderDeliveryInput = {
  conversationId: "conversation_123",
  runtimeId: "codex",
  connectionUrl: "wss://sandbox.example.test/agent",
  inputText: "Handle this webhook",
  workingDirectory: "/workspace/repo",
  deliveryContext: {
    source: "webhook",
    webhookEventId: "evt_123",
    deliveryTaskId: "task_123",
    externalDeliveryId: "delivery_123",
    triggerRunId: "run_123",
    conversationId: "conversation_123",
    sandboxInstanceId: "sandbox_123",
    routeId: "route_123",
  },
  providerConversationId: null,
  providerExecutionId: null,
};

const AssociationDeliveryInput: ExecuteConversationProviderDeliveryInput = {
  conversationId: "conversation_123",
  runtimeId: "codex",
  connectionUrl: "wss://sandbox.example.test/agent",
  inputText: "Handle this PR comment",
  workingDirectory: "/workspace/repo",
  deliveryContext: {
    source: "provider_resource_association",
    webhookEventId: "evt_123",
    deliveryTaskId: "prd_123",
    externalDeliveryId: "delivery_123",
    providerResourceAssociationId: "pra_123",
    conversationId: "conversation_123",
    sandboxInstanceId: "sandbox_123",
    routeId: "route_123",
  },
  providerConversationId: "thread_123",
  providerExecutionId: null,
};

describe("provider delivery idempotency metadata", () => {
  it("derives a stable createConversation envelope from the delivery task", () => {
    expect(createConversationIdempotencyMetadata(DeliveryInput)).toEqual({
      key: "trigger-conversation-delivery:task_123:create-conversation",
      operation: "createConversation",
      requestFingerprint: "sha256:856b5bcb8698b7c6b810c812151ecaeafc61b69e84e0738ec396407bce24f950",
    });
  });

  it("derives a stable submitPayload envelope from the logical payload delivery", () => {
    expect(
      submitPayloadIdempotencyMetadata({
        deliveryInput: DeliveryInput,
        providerConversationId: "thread_123",
      }),
    ).toEqual({
      key: "trigger-conversation-delivery:task_123:submit-payload",
      operation: "submitPayload",
      requestFingerprint: "sha256:4637ba033ca97e6c2011c334d05ddb73eda5f88a2111ea02b124ed94e45dfb1c",
    });
  });

  it("derives a stable association submitPayload envelope from the logical payload delivery", () => {
    expect(
      submitPayloadIdempotencyMetadata({
        deliveryInput: AssociationDeliveryInput,
        providerConversationId: "thread_123",
      }),
    ).toEqual({
      key: "provider-resource-association-delivery:prd_123:submit-payload",
      operation: "submitPayload",
      requestFingerprint: "sha256:7026ffb2d308abf9e53e732d90360c6e75cd20a0fa6715ca6d091f8e4c44aabd",
    });
  });
});
