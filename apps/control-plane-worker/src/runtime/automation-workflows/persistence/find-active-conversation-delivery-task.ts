import { AutomationConversationDeliveryTaskStatuses } from "@mistle/db/control-plane";

import type { AutomationConversationPersistenceDependencies } from "./types.js";

export type FindActiveAutomationConversationDeliveryTaskInput = {
  conversationId: string;
  generation: number;
};

export async function findActiveAutomationConversationDeliveryTask(
  deps: AutomationConversationPersistenceDependencies,
  input: FindActiveAutomationConversationDeliveryTaskInput,
) {
  return deps.db.query.automationConversationDeliveryTasks.findFirst({
    where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
      whereAnd(
        whereEq(table.conversationId, input.conversationId),
        whereEq(table.processorGeneration, input.generation),
        whereOr(
          whereEq(table.status, AutomationConversationDeliveryTaskStatuses.CLAIMED),
          whereEq(table.status, AutomationConversationDeliveryTaskStatuses.DELIVERING),
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
