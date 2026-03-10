import { AutomationConversationDeliveryTaskStatuses } from "@mistle/db/control-plane";

import { setAutomationConversationDeliveryProcessorIdle } from "./set-conversation-delivery-processor-idle.js";
import type { AutomationConversationPersistenceDependencies } from "./types.js";

export type IdleAutomationConversationDeliveryProcessorIfEmptyInput = {
  conversationId: string;
  generation: number;
};

export async function idleAutomationConversationDeliveryProcessorIfEmpty(
  deps: AutomationConversationPersistenceDependencies,
  input: IdleAutomationConversationDeliveryProcessorIfEmptyInput,
): Promise<boolean> {
  return deps.db.transaction(async (tx) => {
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
