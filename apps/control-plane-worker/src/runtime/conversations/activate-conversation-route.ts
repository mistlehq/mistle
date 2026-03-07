import {
  conversationRoutes,
  conversations,
  ConversationRouteStatuses,
  ConversationStatuses,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type ActivateConversationRouteInput = {
  conversationId: string;
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId?: string | null;
  providerState?: unknown;
};

export async function activateConversationRoute(
  deps: ConversationPersistenceDependencies,
  input: ActivateConversationRouteInput,
) {
  return deps.db.transaction(async (transaction) => {
    const persistedConversation = await transaction.query.conversations.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.conversationId),
    });
    if (persistedConversation === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
        message: `Conversation '${input.conversationId}' was not found.`,
      });
    }
    if (persistedConversation.status === ConversationStatuses.CLOSED) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
        message: `Conversation '${input.conversationId}' is closed and cannot be activated.`,
      });
    }

    const persistedRoute = await transaction.query.conversationRoutes.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, input.routeId),
    });
    if (persistedRoute === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `Conversation route '${input.routeId}' was not found.`,
      });
    }
    if (persistedRoute.conversationId !== input.conversationId) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CONVERSATION_MISMATCH,
        message: `Conversation route '${input.routeId}' does not belong to conversation '${input.conversationId}'.`,
      });
    }
    if (persistedRoute.status === ConversationRouteStatuses.CLOSED) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
        message: `Conversation route '${input.routeId}' is closed and cannot be activated.`,
      });
    }

    await transaction
      .update(conversations)
      .set({
        status: ConversationStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, input.conversationId));

    const updatedRouteRows = await transaction
      .update(conversationRoutes)
      .set({
        sandboxInstanceId: input.sandboxInstanceId,
        providerConversationId: input.providerConversationId,
        providerExecutionId: input.providerExecutionId ?? null,
        providerState: input.providerState ?? null,
        status: ConversationRouteStatuses.ACTIVE,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationRoutes.id, input.routeId))
      .returning();
    const updatedRoute = updatedRouteRows[0];
    if (updatedRoute === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `Conversation route '${input.routeId}' was not found during activation update.`,
      });
    }

    return updatedRoute;
  });
}
