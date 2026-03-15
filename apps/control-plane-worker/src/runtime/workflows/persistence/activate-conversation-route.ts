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
export type ActivateAutomationConversationRouteInput = {
  conversationId: string;
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId?: string | null;
  providerState?: unknown;
};

export async function activateAutomationConversationRoute(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: ActivateAutomationConversationRouteInput,
) {
  return deps.db.transaction(async (transaction) => {
    const persistedAutomationConversation =
      await transaction.query.automationConversations.findFirst({
        where: (table, { eq: whereEq }) => whereEq(table.id, input.conversationId),
      });
    if (persistedAutomationConversation === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
        message: `AutomationConversation '${input.conversationId}' was not found.`,
      });
    }
    if (persistedAutomationConversation.status === AutomationConversationStatuses.CLOSED) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
        message: `AutomationConversation '${input.conversationId}' is closed and cannot be activated.`,
      });
    }

    const persistedRoute = await transaction.query.automationConversationRoutes.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.routeId),
    });
    if (persistedRoute === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `AutomationConversation route '${input.routeId}' was not found.`,
      });
    }
    if (persistedRoute.conversationId !== input.conversationId) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CONVERSATION_MISMATCH,
        message: `AutomationConversation route '${input.routeId}' does not belong to conversation '${input.conversationId}'.`,
      });
    }
    if (persistedRoute.status === AutomationConversationRouteStatuses.CLOSED) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
        message: `AutomationConversation route '${input.routeId}' is closed and cannot be activated.`,
      });
    }

    await transaction
      .update(automationConversations)
      .set({
        status: AutomationConversationStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(automationConversations.id, input.conversationId));

    const updatedRouteRows = await transaction
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
    const updatedRoute = updatedRouteRows[0];
    if (updatedRoute === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `AutomationConversation route '${input.routeId}' was not found during activation update.`,
      });
    }

    return updatedRoute;
  });
}
