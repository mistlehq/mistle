import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "../shared/trigger-conversation-persistence-error.js";
import type { ResolvedTriggerConversationDeliveryRoute } from "./types.js";

export async function resolveTriggerConversationDeliveryRoute(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    conversationId: string;
  },
): Promise<ResolvedTriggerConversationDeliveryRoute> {
  const conversation = await ctx.db.query.triggerConversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (conversation === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `TriggerConversation '${input.conversationId}' was not found.`,
    });
  }

  const route = await ctx.db.query.triggerConversationRoutes.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });

  return {
    conversationId: conversation.id,
    integrationFamilyId: conversation.integrationFamilyId,
    runtimeId: conversation.runtimeId,
    routeId: route?.id ?? null,
    sandboxInstanceId: route?.sandboxInstanceId ?? null,
    providerConversationId: route?.providerConversationId ?? null,
    providerExecutionId: route?.providerExecutionId ?? null,
    providerState: route?.providerState ?? null,
  };
}
