import {
  automationConversationRoutes,
  automationConversations,
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./errors.js";
export type UpdateAutomationConversationExecutionInput = {
  routeId: string;
  providerExecutionId: string | null;
  providerState?: unknown;
};

export async function updateAutomationConversationExecution(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: UpdateAutomationConversationExecutionInput,
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
        message: `AutomationConversation route '${input.routeId}' is closed and cannot update execution state.`,
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
        message: `AutomationConversation '${persistedAutomationConversation.id}' is closed and cannot update execution state.`,
      });
    }

    const updatedRouteRows =
      input.providerState === undefined
        ? await transaction
            .update(automationConversationRoutes)
            .set({
              providerExecutionId: input.providerExecutionId,
              updatedAt: sql`now()`,
            })
            .where(eq(automationConversationRoutes.id, input.routeId))
            .returning()
        : await transaction
            .update(automationConversationRoutes)
            .set({
              providerExecutionId: input.providerExecutionId,
              providerState: input.providerState,
              updatedAt: sql`now()`,
            })
            .where(eq(automationConversationRoutes.id, input.routeId))
            .returning();
    const updatedRoute = updatedRouteRows[0];
    if (updatedRoute === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `AutomationConversation route '${input.routeId}' was not found during execution update.`,
      });
    }

    await transaction
      .update(automationConversations)
      .set({
        lastActivityAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(automationConversations.id, persistedAutomationConversation.id));

    return updatedRoute;
  });
}
