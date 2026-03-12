import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./error.js";
import type {
  HandleAutomationConversationDeliveryDependencies,
  ResolvedAutomationConversationDeliveryRoute,
} from "./types.js";

export async function resolveAutomationConversationDeliveryRoute(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    conversationId: string;
  },
): Promise<ResolvedAutomationConversationDeliveryRoute> {
  const conversation = await ctx.db.query.automationConversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (conversation === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `AutomationConversation '${input.conversationId}' was not found.`,
    });
  }

  const route = await ctx.db.query.automationConversationRoutes.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });

  return {
    conversationId: conversation.id,
    integrationFamilyId: conversation.integrationFamilyId,
    routeId: route?.id ?? null,
    sandboxInstanceId: route?.sandboxInstanceId ?? null,
    providerConversationId: route?.providerConversationId ?? null,
    providerExecutionId: route?.providerExecutionId ?? null,
    providerState: route?.providerState ?? null,
  };
}
