import {
  automationConversationDeliveryProcessors,
  AutomationConversationDeliveryProcessorStatuses,
  AutomationConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type { AutomationConversationPersistenceDependencies } from "./types.js";

export async function setAutomationConversationDeliveryProcessorIdle(
  ctx: AutomationConversationPersistenceDependencies,
  input: {
    conversationId: string;
    generation: number;
  },
): Promise<boolean> {
  const updatedRows = await ctx.db
    .update(automationConversationDeliveryProcessors)
    .set({
      status: AutomationConversationDeliveryProcessorStatuses.IDLE,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationConversationDeliveryProcessors.conversationId, input.conversationId),
        eq(automationConversationDeliveryProcessors.generation, input.generation),
        eq(
          automationConversationDeliveryProcessors.status,
          AutomationConversationDeliveryProcessorStatuses.RUNNING,
        ),
      ),
    )
    .returning({
      conversationId: automationConversationDeliveryProcessors.conversationId,
    });

  return updatedRows[0] !== undefined;
}

export async function idleAutomationConversationDeliveryProcessorIfEmpty(
  ctx: AutomationConversationPersistenceDependencies,
  input: {
    conversationId: string;
    generation: number;
  },
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const queuedTask = await tx.query.automationConversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereOr(
            whereEq(table.status, AutomationConversationDeliveryTaskStatuses.QUEUED),
            whereEq(table.status, AutomationConversationDeliveryTaskStatuses.CLAIMED),
            whereEq(table.status, AutomationConversationDeliveryTaskStatuses.DELIVERING),
          ),
        ),
    });
    if (queuedTask !== undefined) {
      return false;
    }

    return setAutomationConversationDeliveryProcessorIdle(
      {
        db: tx,
      },
      input,
    );
  });
}
