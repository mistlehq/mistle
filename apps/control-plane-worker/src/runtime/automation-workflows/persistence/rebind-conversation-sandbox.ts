import {
  automationConversationRoutes,
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
} from "@mistle/db/control-plane";
import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
  type AutomationConversationPersistenceDependencies,
} from "@mistle/workflows/control-plane/runtime";
import { eq, sql } from "drizzle-orm";

export type RebindAutomationConversationSandboxInput = {
  routeId: string;
  sandboxInstanceId: string;
};

export async function rebindAutomationConversationSandbox(
  deps: AutomationConversationPersistenceDependencies,
  input: RebindAutomationConversationSandboxInput,
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
        message: `AutomationConversation route '${input.routeId}' is closed and cannot be rebound.`,
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
        message: `AutomationConversation '${persistedRoute.conversationId}' is closed and cannot be rebound.`,
      });
    }

    const updatedRows = await transaction
      .update(automationConversationRoutes)
      .set({
        sandboxInstanceId: input.sandboxInstanceId,
        providerExecutionId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(automationConversationRoutes.id, input.routeId))
      .returning();
    const updatedRoute = updatedRows[0];
    if (updatedRoute === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `AutomationConversation route '${input.routeId}' was not found during rebind update.`,
      });
    }

    return updatedRoute;
  });
}
