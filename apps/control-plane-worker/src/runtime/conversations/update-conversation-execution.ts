import {
  conversationRoutes,
  conversations,
  ConversationRouteStatuses,
  ConversationStatuses,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type UpdateConversationExecutionInput = {
  routeId: string;
  providerExecutionId: string | null;
  providerState?: unknown;
};

export async function updateConversationExecution(
  deps: ConversationPersistenceDependencies,
  input: UpdateConversationExecutionInput,
) {
  return deps.db.transaction(async (transaction) => {
    const persistedRoute = await transaction.query.conversationRoutes.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.routeId),
    });
    if (persistedRoute === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `Conversation route '${input.routeId}' was not found.`,
      });
    }
    if (persistedRoute.status === ConversationRouteStatuses.CLOSED) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
        message: `Conversation route '${input.routeId}' is closed and cannot update execution state.`,
      });
    }

    const persistedConversation = await transaction.query.conversations.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, persistedRoute.conversationId),
    });
    if (persistedConversation === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
        message: `Conversation '${persistedRoute.conversationId}' was not found.`,
      });
    }
    if (persistedConversation.status === ConversationStatuses.CLOSED) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
        message: `Conversation '${persistedConversation.id}' is closed and cannot update execution state.`,
      });
    }

    const updatedRouteRows =
      input.providerState === undefined
        ? await transaction
            .update(conversationRoutes)
            .set({
              providerExecutionId: input.providerExecutionId,
              updatedAt: sql`now()`,
            })
            .where(eq(conversationRoutes.id, input.routeId))
            .returning()
        : await transaction
            .update(conversationRoutes)
            .set({
              providerExecutionId: input.providerExecutionId,
              providerState: input.providerState,
              updatedAt: sql`now()`,
            })
            .where(eq(conversationRoutes.id, input.routeId))
            .returning();
    const updatedRoute = updatedRouteRows[0];
    if (updatedRoute === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `Conversation route '${input.routeId}' was not found during execution update.`,
      });
    }

    await transaction
      .update(conversations)
      .set({
        lastActivityAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, persistedConversation.id));

    return updatedRoute;
  });
}
