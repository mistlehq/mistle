import {
  automationConversationRoutes,
  automationConversations,
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
} from "@mistle/db/control-plane";
import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
  type AutomationConversationPersistenceDependencies,
} from "@mistle/workflows/control-plane/runtime";
import { eq, sql } from "drizzle-orm";

export type ReplaceAutomationConversationBindingInput = {
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId?: string | null;
  providerState?: unknown;
};

export async function replaceAutomationConversationBinding(
  deps: AutomationConversationPersistenceDependencies,
  input: ReplaceAutomationConversationBindingInput,
) {
  return deps.db.transaction(async (transaction) => {
    const persistedRoute = await transaction.query.automationConversationRoutes.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.routeId),
    });
    if (persistedRoute === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `AutomationConversation route '${input.routeId}' was not found.`,
      });
    }
    if (persistedRoute.status === AutomationConversationRouteStatuses.CLOSED) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
        message: `AutomationConversation route '${input.routeId}' is closed and cannot replace binding.`,
      });
    }

    const persistedAutomationConversation =
      await transaction.query.automationConversations.findFirst({
        where: (table, { eq: whereEq }) => whereEq(table.id, persistedRoute.conversationId),
      });
    if (persistedAutomationConversation === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
        message: `AutomationConversation '${persistedRoute.conversationId}' was not found.`,
      });
    }
    if (persistedAutomationConversation.status === AutomationConversationStatuses.CLOSED) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
        message: `AutomationConversation '${persistedAutomationConversation.id}' is closed and cannot replace binding.`,
      });
    }

    await transaction
      .update(automationConversations)
      .set({
        status: AutomationConversationStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(automationConversations.id, persistedAutomationConversation.id));

    const updatedRows = await transaction
      .update(automationConversationRoutes)
      .set({
        sandboxInstanceId: input.sandboxInstanceId,
        providerConversationId: input.providerConversationId,
        providerExecutionId: input.providerExecutionId ?? null,
        providerState: input.providerState ?? null,
        status: AutomationConversationRouteStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(automationConversationRoutes.id, input.routeId))
      .returning();
    const updatedRoute = updatedRows[0];
    if (updatedRoute === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `AutomationConversation route '${input.routeId}' was not found during replace binding update.`,
      });
    }

    return updatedRoute;
  });
}
