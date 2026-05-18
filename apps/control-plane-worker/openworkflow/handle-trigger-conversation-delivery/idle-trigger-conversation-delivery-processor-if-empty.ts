import {
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";

import { setTriggerConversationDeliveryProcessorIdle } from "../shared/set-conversation-delivery-processor-idle.js";

export type IdleTriggerConversationDeliveryProcessorIfEmptyInput = {
  conversationId: string;
  generation: number;
};

export async function idleTriggerConversationDeliveryProcessorIfEmpty(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: IdleTriggerConversationDeliveryProcessorIfEmptyInput,
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const queuedTask = await tx.query.triggerConversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereOr(
            whereEq(table.status, TriggerConversationDeliveryTaskStatuses.QUEUED),
            whereEq(table.status, TriggerConversationDeliveryTaskStatuses.CLAIMED),
            whereEq(table.status, TriggerConversationDeliveryTaskStatuses.DELIVERING),
          ),
        ),
    });
    if (queuedTask !== undefined) {
      return false;
    }

    return setTriggerConversationDeliveryProcessorIdle(
      {
        db: tx,
      },
      input,
    );
  });
}
