import { ConversationDeliveryTaskStatuses } from "@mistle/db/control-plane";

import type { ConversationPersistenceDependencies } from "./types.js";

export type FindActiveConversationDeliveryTaskInput = {
  conversationId: string;
  generation: number;
};

export async function findActiveConversationDeliveryTask(
  deps: ConversationPersistenceDependencies,
  input: FindActiveConversationDeliveryTaskInput,
) {
  return deps.db.query.conversationDeliveryTasks.findFirst({
    where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
      whereAnd(
        whereEq(table.conversationId, input.conversationId),
        whereEq(table.processorGeneration, input.generation),
        whereOr(
          whereEq(table.status, ConversationDeliveryTaskStatuses.CLAIMED),
          whereEq(table.status, ConversationDeliveryTaskStatuses.DELIVERING),
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
