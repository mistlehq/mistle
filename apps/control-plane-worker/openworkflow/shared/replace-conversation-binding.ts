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
export type ReplaceTriggerConversationBindingInput = {
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId?: string | null;
  providerState?: unknown;
};

export async function replaceTriggerConversationBinding(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: ReplaceTriggerConversationBindingInput,
) {
  return deps.db.transaction(async (transaction) => {
    const tables = getControlPlaneDatabaseSchema(transaction);

    const persistedRoute = await transaction.query.triggerConversationRoutes.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.routeId),
    });
    if (persistedRoute === undefined) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `TriggerConversation route '${input.routeId}' was not found.`,
      });
    }
    if (persistedRoute.status === TriggerConversationRouteStatuses.CLOSED) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
        message: `TriggerConversation route '${input.routeId}' is closed and cannot replace binding.`,
      });
    }

    const persistedTriggerConversation = await transaction.query.triggerConversations.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, persistedRoute.conversationId),
    });
    if (persistedTriggerConversation === undefined) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
        message: `TriggerConversation '${persistedRoute.conversationId}' was not found.`,
      });
    }
    if (persistedTriggerConversation.status === TriggerConversationStatuses.CLOSED) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
        message: `TriggerConversation '${persistedTriggerConversation.id}' is closed and cannot replace binding.`,
      });
    }

    await transaction
      .update(tables.triggerConversations)
      .set({
        status: TriggerConversationStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.triggerConversations.id, persistedTriggerConversation.id));

    const updatedRows = await transaction
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
    const updatedRoute = updatedRows[0];
    if (updatedRoute === undefined) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `TriggerConversation route '${input.routeId}' was not found during replace binding update.`,
      });
    }

    return updatedRoute;
  });
}
