import {
  automationConversationDeliveryTasks,
  AutomationConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type { AutomationConversationPersistenceDependencies } from "./types.js";

export type ClaimNextConversationDeliveryTaskInput = {
  conversationId: string;
  generation: number;
};

export async function claimNextAutomationConversationDeliveryTask(
  ctx: AutomationConversationPersistenceDependencies,
  input: ClaimNextConversationDeliveryTaskInput,
) {
  return ctx.db.transaction(async (tx) => {
    const nextTask = await tx.query.automationConversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, AutomationConversationDeliveryTaskStatuses.QUEUED),
        ),
      orderBy: (table, { asc: orderAsc }) => [
        orderAsc(table.sourceOrderKey),
        orderAsc(table.createdAt),
        orderAsc(table.id),
      ],
    });
    if (nextTask === undefined) {
      return null;
    }

    const updatedRows = await tx
      .update(automationConversationDeliveryTasks)
      .set({
        status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: input.generation,
        attemptCount: sql`${automationConversationDeliveryTasks.attemptCount} + 1`,
        claimedAt: sql`now()`,
        deliveryStartedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(automationConversationDeliveryTasks.id, nextTask.id),
          eq(
            automationConversationDeliveryTasks.status,
            AutomationConversationDeliveryTaskStatuses.QUEUED,
          ),
        ),
      )
      .returning();

    return updatedRows[0] ?? null;
  });
}
