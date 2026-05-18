import {
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "./trigger-conversation-persistence-error.js";
export type CreateTriggerConversationRouteInput = {
  conversationId: string;
  sandboxInstanceId: string;
};

export async function createTriggerConversationRoute(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: CreateTriggerConversationRouteInput,
) {
  const tables = getControlPlaneDatabaseSchema(deps.db);

  const existingTriggerConversation = await deps.db.query.triggerConversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (existingTriggerConversation === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `TriggerConversation '${input.conversationId}' was not found.`,
    });
  }
  if (existingTriggerConversation.status === TriggerConversationStatuses.CLOSED) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
      message: `TriggerConversation '${input.conversationId}' is closed and cannot create a route.`,
    });
  }

  const insertedRows = await deps.db
    .insert(tables.triggerConversationRoutes)
    .values({
      conversationId: input.conversationId,
      sandboxInstanceId: input.sandboxInstanceId,
      providerConversationId: null,
      providerExecutionId: null,
      providerState: null,
      status: TriggerConversationRouteStatuses.ACTIVE,
    })
    .onConflictDoNothing({
      target: [tables.triggerConversationRoutes.conversationId],
    })
    .returning();
  const insertedRoute = insertedRows[0];
  if (insertedRoute !== undefined) {
    return insertedRoute;
  }

  const existingRoute = await deps.db.query.triggerConversationRoutes.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });
  if (existingRoute === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message:
        "TriggerConversation route insert conflict occurred but no existing conversation route record could be loaded.",
    });
  }
  if (existingRoute.status === TriggerConversationRouteStatuses.CLOSED) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
      message: `TriggerConversation route '${existingRoute.id}' is closed and cannot be reused.`,
    });
  }

  return existingRoute;
}
