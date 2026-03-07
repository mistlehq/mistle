import {
  conversationRoutes,
  ConversationRouteStatuses,
  ConversationStatuses,
} from "@mistle/db/control-plane";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type CreateConversationRouteInput = {
  conversationId: string;
  sandboxInstanceId: string;
};

export async function createConversationRoute(
  deps: ConversationPersistenceDependencies,
  input: CreateConversationRouteInput,
) {
  const existingConversation = await deps.db.query.conversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (existingConversation === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `Conversation '${input.conversationId}' was not found.`,
    });
  }
  if (existingConversation.status === ConversationStatuses.CLOSED) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
      message: `Conversation '${input.conversationId}' is closed and cannot create a route.`,
    });
  }

  const insertedRows = await deps.db
    .insert(conversationRoutes)
    .values({
      conversationId: input.conversationId,
      sandboxInstanceId: input.sandboxInstanceId,
      providerConversationId: null,
      providerExecutionId: null,
      providerState: null,
      status: ConversationRouteStatuses.ACTIVE,
    })
    .onConflictDoNothing({
      target: [conversationRoutes.conversationId],
    })
    .returning();
  const insertedRoute = insertedRows[0];
  if (insertedRoute !== undefined) {
    return insertedRoute;
  }

  const existingRoute = await deps.db.query.conversationRoutes.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });
  if (existingRoute === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message:
        "Conversation route insert conflict occurred but no existing conversation route record could be loaded.",
    });
  }
  if (existingRoute.status === ConversationRouteStatuses.CLOSED) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
      message: `Conversation route '${existingRoute.id}' is closed and cannot be reused.`,
    });
  }

  return existingRoute;
}
