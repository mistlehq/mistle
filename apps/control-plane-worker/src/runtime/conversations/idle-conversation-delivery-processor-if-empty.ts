import { ConversationDeliveryTaskStatuses } from "@mistle/db/control-plane";

import { setConversationDeliveryProcessorIdle } from "./set-conversation-delivery-processor-idle.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type IdleConversationDeliveryProcessorIfEmptyInput = {
  conversationId: string;
  generation: number;
};

export async function idleConversationDeliveryProcessorIfEmpty(
  deps: ConversationPersistenceDependencies,
  input: IdleConversationDeliveryProcessorIfEmptyInput,
): Promise<boolean> {
  return deps.db.transaction(async (tx) => {
    const queuedTask = await tx.query.conversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereOr(
            whereEq(table.status, ConversationDeliveryTaskStatuses.QUEUED),
            whereEq(table.status, ConversationDeliveryTaskStatuses.CLAIMED),
            whereEq(table.status, ConversationDeliveryTaskStatuses.DELIVERING),
          ),
        ),
    });
    if (queuedTask !== undefined) {
      return false;
    }

    return setConversationDeliveryProcessorIdle(
      {
        db: tx,
      },
      input,
    );
  });
}
