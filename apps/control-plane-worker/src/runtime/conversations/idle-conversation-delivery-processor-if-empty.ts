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
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, ConversationDeliveryTaskStatuses.QUEUED),
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
