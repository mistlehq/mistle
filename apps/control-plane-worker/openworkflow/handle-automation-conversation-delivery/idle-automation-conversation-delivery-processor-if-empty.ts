import {
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";

import { setAutomationConversationDeliveryProcessorIdle } from "../../src/runtime/workflows/persistence/set-conversation-delivery-processor-idle.js";

export type IdleAutomationConversationDeliveryProcessorIfEmptyInput = {
  conversationId: string;
  generation: number;
};

export async function idleAutomationConversationDeliveryProcessorIfEmpty(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: IdleAutomationConversationDeliveryProcessorIfEmptyInput,
): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
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
