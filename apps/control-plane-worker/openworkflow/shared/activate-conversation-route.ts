import {
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "./trigger-conversation-persistence-error.js";
export type ActivateTriggerConversationRouteInput = {
  conversationId: string;
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId?: string | null;
  providerState?: unknown;
};

export async function activateTriggerConversationRoute(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: ActivateTriggerConversationRouteInput,
) {
  return deps.db.transaction(async (transaction) => {
    const tables = getControlPlaneDatabaseSchema(transaction);

    const persistedTriggerConversation = await transaction.query.triggerConversations.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.conversationId),
    });
    if (persistedTriggerConversation === undefined) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
        message: `TriggerConversation '${input.conversationId}' was not found.`,
      });
    }
    if (persistedTriggerConversation.status === TriggerConversationStatuses.CLOSED) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
        message: `TriggerConversation '${input.conversationId}' is closed and cannot be activated.`,
      });
    }

    const persistedRoute = await transaction.query.triggerConversationRoutes.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.routeId),
    });
    if (persistedRoute === undefined) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `TriggerConversation route '${input.routeId}' was not found.`,
      });
    }
    if (persistedRoute.conversationId !== input.conversationId) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CONVERSATION_MISMATCH,
        message: `TriggerConversation route '${input.routeId}' does not belong to conversation '${input.conversationId}'.`,
      });
    }
    if (persistedRoute.status === TriggerConversationRouteStatuses.CLOSED) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
        message: `TriggerConversation route '${input.routeId}' is closed and cannot be activated.`,
      });
    }

    await transaction
      .update(tables.triggerConversations)
      .set({
        status: TriggerConversationStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.triggerConversations.id, input.conversationId));

    const updatedRouteRows = await transaction
      .update(tables.triggerConversationRoutes)
      .set({
        sandboxInstanceId: input.sandboxInstanceId,
        providerConversationId: input.providerConversationId,
        providerExecutionId: input.providerExecutionId ?? null,
        providerState: input.providerState ?? null,
        status: TriggerConversationRouteStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.triggerConversationRoutes.id, input.routeId))
      .returning();
    const updatedRoute = updatedRouteRows[0];
    if (updatedRoute === undefined) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `TriggerConversation route '${input.routeId}' was not found during activation update.`,
      });
    }

    return updatedRoute;
  });
}
