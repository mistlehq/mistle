import {
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";

export type FindActiveTriggerConversationDeliveryTaskInput = {
  conversationId: string;
  generation: number;
};

export async function findActiveTriggerConversationDeliveryTask(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: FindActiveTriggerConversationDeliveryTaskInput,
) {
  return ctx.db.query.triggerConversationDeliveryTasks.findFirst({
    where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
      whereAnd(
        whereEq(table.conversationId, input.conversationId),
        whereEq(table.processorGeneration, input.generation),
        whereOr(
          whereEq(table.status, TriggerConversationDeliveryTaskStatuses.CLAIMED),
          whereEq(table.status, TriggerConversationDeliveryTaskStatuses.DELIVERING),
        ),
      ),
    orderBy: (table, { asc: orderAsc }) => [
      orderAsc(table.claimedAt),
      orderAsc(table.deliveryStartedAt),
      orderAsc(table.createdAt),
      orderAsc(table.id),
    ],
  });
}
