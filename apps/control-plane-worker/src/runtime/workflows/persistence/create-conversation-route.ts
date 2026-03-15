import {
  automationConversationRoutes,
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./errors.js";
export type CreateAutomationConversationRouteInput = {
  conversationId: string;
  sandboxInstanceId: string;
};

export async function createAutomationConversationRoute(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: CreateAutomationConversationRouteInput,
) {
  const existingAutomationConversation = await deps.db.query.automationConversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (existingAutomationConversation === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `AutomationConversation '${input.conversationId}' was not found.`,
    });
  }
  if (existingAutomationConversation.status === AutomationConversationStatuses.CLOSED) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
      message: `AutomationConversation '${input.conversationId}' is closed and cannot create a route.`,
    });
  }

  const insertedRows = await deps.db
    .insert(automationConversationRoutes)
    .values({
      conversationId: input.conversationId,
      sandboxInstanceId: input.sandboxInstanceId,
      providerConversationId: null,
      providerExecutionId: null,
      providerState: null,
      status: AutomationConversationRouteStatuses.ACTIVE,
    })
    .onConflictDoNothing({
      target: [automationConversationRoutes.conversationId],
    })
    .returning();
  const insertedRoute = insertedRows[0];
  if (insertedRoute !== undefined) {
    return insertedRoute;
  }

  const existingRoute = await deps.db.query.automationConversationRoutes.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });
  if (existingRoute === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message:
        "AutomationConversation route insert conflict occurred but no existing conversation route record could be loaded.",
    });
  }
  if (existingRoute.status === AutomationConversationRouteStatuses.CLOSED) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
      message: `AutomationConversation route '${existingRoute.id}' is closed and cannot be reused.`,
    });
  }

  return existingRoute;
}
