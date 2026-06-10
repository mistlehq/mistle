import { submitPayloadIdempotencyMetadata } from "../handle-trigger-conversation-delivery/delivery-idempotency.js";
import { getConversationProviderAdapter } from "../handle-trigger-conversation-delivery/provider-adapter.js";
import type { ExecuteConversationProviderDeliveryInput } from "../handle-trigger-conversation-delivery/types.js";
import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

const ThreadResumeMethod = "thread/resume";
const TurnStartMethod = "turn/start";

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
  deliveryInput: ExecuteConversationProviderDeliveryInput;
  providerConversationId: string;
}): Promise<{
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
    await connection.request({
      method: ThreadResumeMethod,
      params: {
        threadId: input.providerConversationId,
      },
    });

    const response = await connection.request({
      method: TurnStartMethod,
      idempotency: submitPayloadIdempotencyMetadata({
        deliveryInput: input.deliveryInput,
        providerConversationId: input.providerConversationId,
      }),
      params: {
        threadId: input.providerConversationId,
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
