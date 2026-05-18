import {
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

export type ClaimNextConversationDeliveryTaskInput = {
  conversationId: string;
  generation: number;
};

export async function claimNextTriggerConversationDeliveryTask(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: ClaimNextConversationDeliveryTaskInput,
) {
  return ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const nextTask = await tx.query.triggerConversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, TriggerConversationDeliveryTaskStatuses.QUEUED),
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
      .update(tables.triggerConversationDeliveryTasks)
      .set({
        status: TriggerConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: input.generation,
        attemptCount: sql`${tables.triggerConversationDeliveryTasks.attemptCount} + 1`,
        claimedAt: sql`now()`,
        deliveryStartedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.triggerConversationDeliveryTasks.id, nextTask.id),
          eq(
            tables.triggerConversationDeliveryTasks.status,
            TriggerConversationDeliveryTaskStatuses.QUEUED,
          ),
        ),
      )
      .returning();

    return updatedRows[0] ?? null;
  });
}
