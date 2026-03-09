import {
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type { ConversationPersistenceDependencies } from "./types.js";

export type ClaimNextConversationDeliveryTaskInput = {
  conversationId: string;
  generation: number;
};

export async function claimNextConversationDeliveryTask(
  deps: ConversationPersistenceDependencies,
  input: ClaimNextConversationDeliveryTaskInput,
) {
  return deps.db.transaction(async (tx) => {
    const nextTask = await tx.query.conversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, ConversationDeliveryTaskStatuses.QUEUED),
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
      .update(conversationDeliveryTasks)
      .set({
        status: ConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: input.generation,
        attemptCount: sql`${conversationDeliveryTasks.attemptCount} + 1`,
        claimedAt: sql`now()`,
        deliveryStartedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(conversationDeliveryTasks.id, nextTask.id),
          eq(conversationDeliveryTasks.status, ConversationDeliveryTaskStatuses.QUEUED),
        ),
      )
      .returning();

    return updatedRows[0] ?? null;
  });
}
