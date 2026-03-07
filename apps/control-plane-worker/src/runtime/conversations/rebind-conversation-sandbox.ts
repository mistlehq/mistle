import {
  conversationRoutes,
  ConversationRouteStatuses,
  ConversationStatuses,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type RebindConversationSandboxInput = {
  routeId: string;
  sandboxInstanceId: string;
};

export async function rebindConversationSandbox(
  deps: ConversationPersistenceDependencies,
  input: RebindConversationSandboxInput,
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
        message: `Conversation route '${input.routeId}' is closed and cannot be rebound.`,
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
        message: `Conversation '${persistedRoute.conversationId}' is closed and cannot be rebound.`,
      });
    }

    const updatedRows = await transaction
      .update(conversationRoutes)
      .set({
        sandboxInstanceId: input.sandboxInstanceId,
        providerExecutionId: null,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationRoutes.id, input.routeId))
      .returning();
    const updatedRoute = updatedRows[0];
    if (updatedRoute === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `Conversation route '${input.routeId}' was not found during rebind update.`,
      });
    }

    return updatedRoute;
  });
}
