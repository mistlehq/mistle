import { createHash } from "node:crypto";

import type {
  AgentConversationIdempotencyMetadata,
  AgentConversationIdempotencyOperation,
} from "@mistle/integrations-core";
import {
  AllCodexThreadSourceKinds,
  parseCodexThreadListResponse,
  resolveOriginalCodexThreadId,
  type CodexThreadSummary,
} from "@mistle/integrations-definitions/agent-runtimes/codex/client";

import { getConversationProviderAdapter } from "../handle-trigger-conversation-delivery/provider-adapter.js";
import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

const OriginalCodexThreadListPageSize = 100;
const ThreadResumeMethod = "thread/resume";
const TurnStartMethod = "turn/start";

type ProviderResourceAssociationCodexDeliveryInput = {
  runtimeId: string;
  connectionUrl: string;
  inputText: string;
  deliveryId: string;
  providerResourceAssociationId: string;
};

type CodexTurnStartResponse = {
  turn: {
    id: string;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCodexTurnStartResponse(response: unknown): CodexTurnStartResponse {
  if (!isRecord(response)) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: "Codex associated-resource turn/start response was not an object.",
    });
  }

  const turn = response["turn"];
  if (!isRecord(turn)) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: "Codex associated-resource turn/start response did not include turn.",
    });
  }

  const turnId = turn["id"];
  if (typeof turnId !== "string" || turnId.length === 0) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: "Codex associated-resource turn/start response did not include turn.id.",
    });
  }

  return {
    turn: {
      id: turnId,
    },
  };
}

export async function submitCodexAssociatedResourceDelivery(input: {
  deliveryInput: ProviderResourceAssociationCodexDeliveryInput;
}): Promise<{
  providerConversationId: string;
  providerExecutionId: string;
}> {
  if (input.deliveryInput.runtimeId !== "codex") {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
      message: `Provider resource association delivery only supports direct associated-resource submit for Codex, received '${input.deliveryInput.runtimeId}'.`,
    });
  }

  const adapter = getConversationProviderAdapter("codex");
  const connection = await adapter.connect({
    connectionUrl: input.deliveryInput.connectionUrl,
  });

  try {
    const providerConversationId = resolveOriginalCodexThreadId([
      ...(await listOriginalCodexThreadCandidates({ connection })),
      ...(await listOriginalCodexThreadCandidates({ connection, archived: true })),
    ]);
    if (providerConversationId === null) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_NOT_FOUND,
        message: "Associated sandbox Codex runtime does not have an original non-subagent thread.",
      });
    }

    await connection.request({
      method: ThreadResumeMethod,
      params: {
        threadId: providerConversationId,
      },
    });

    const response = await connection.request({
      method: TurnStartMethod,
      idempotency: submitPayloadIdempotencyMetadata({
        deliveryInput: input.deliveryInput,
        providerConversationId,
      }),
      params: {
        threadId: providerConversationId,
        input: [
          {
            type: "text",
            text: input.deliveryInput.inputText,
          },
        ],
      },
    });
    const parsedResponse = parseCodexTurnStartResponse(response);

    return {
      providerConversationId,
      providerExecutionId: parsedResponse.turn.id,
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
          : "Codex associated-resource delivery failed with non-error exception.",
      cause: error,
    });
  } finally {
    await connection.close();
  }
}

async function listOriginalCodexThreadCandidates(input: {
  connection: {
    request: (input: { method: string; params?: Record<string, unknown> }) => Promise<unknown>;
  };
  archived?: boolean;
}): Promise<readonly CodexThreadSummary[]> {
  let cursor: string | null = null;
  const threads: CodexThreadSummary[] = [];

  do {
    const response = await input.connection.request({
      method: "thread/list",
      params: {
        cursor,
        limit: OriginalCodexThreadListPageSize,
        ...(input.archived === undefined ? {} : { archived: input.archived }),
        sortKey: "created_at",
        sourceKinds: AllCodexThreadSourceKinds,
      },
    });
    const parsedResponse = parseCodexThreadListResponse(response);
    threads.push(...parsedResponse.threads);
    cursor = parsedResponse.nextCursor;
  } while (cursor !== null);

  return threads;
}

function submitPayloadIdempotencyMetadata(input: {
  deliveryInput: ProviderResourceAssociationCodexDeliveryInput;
  providerConversationId: string;
}): AgentConversationIdempotencyMetadata {
  return {
    key: `provider-resource-association-delivery:${input.deliveryInput.deliveryId}:submit-payload`,
    operation: "submitPayload",
    requestFingerprint: createRuntimeRequestFingerprint({
      runtimeId: input.deliveryInput.runtimeId,
      operation: "submitPayload",
      fields: {
        delivery_task_id: input.deliveryInput.deliveryId,
        input_text: input.deliveryInput.inputText,
        provider_conversation_id: input.providerConversationId,
        provider_resource_association_id: input.deliveryInput.providerResourceAssociationId,
      },
    }),
  };
}

function createRuntimeRequestFingerprint(input: {
  runtimeId: string;
  operation: AgentConversationIdempotencyOperation;
  fields: Record<string, string | null>;
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

function resolveRuntimeIdempotencyOperation(
  operation: AgentConversationIdempotencyOperation,
): "create_conversation" | "submit_payload" {
  switch (operation) {
    case "createConversation":
      return "create_conversation";
    case "submitPayload":
      return "submit_payload";
  }
}

function resolveRuntimeIdempotencyRuntimeId(runtimeId: string): "codex" {
  if (runtimeId === "codex") {
    return "codex";
  }

  throw new ProviderResourceAssociationDeliveryError({
    code: ProviderResourceAssociationDeliveryFailureCodes.PROVIDER_DELIVERY_FAILED,
    message: `Agent runtime '${runtimeId}' does not support Codex associated-resource delivery idempotency metadata.`,
  });
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
