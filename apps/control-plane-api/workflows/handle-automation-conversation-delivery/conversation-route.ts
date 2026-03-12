import {
  automationConversationRoutes,
  automationConversations,
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
} from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./error.js";
import type { AutomationConversationPersistenceDependencies } from "./types.js";

export async function createAutomationConversationRoute(
  deps: AutomationConversationPersistenceDependencies,
  input: {
    conversationId: string;
    sandboxInstanceId: string;
  },
) {
  const existingAutomationConversation = await deps.db.query.automationConversations.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.conversationId),
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
    where: (table, { eq: whereEq }) => whereEq(table.conversationId, input.conversationId),
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

export async function activateAutomationConversationRoute(
  deps: AutomationConversationPersistenceDependencies,
  input: {
    conversationId: string;
    routeId: string;
    sandboxInstanceId: string;
    providerConversationId: string;
    providerExecutionId?: string | null;
    providerState?: unknown;
  },
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

export async function updateAutomationConversationExecution(
  deps: AutomationConversationPersistenceDependencies,
  input: {
    routeId: string;
    providerExecutionId: string | null;
    providerState?: unknown;
  },
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
