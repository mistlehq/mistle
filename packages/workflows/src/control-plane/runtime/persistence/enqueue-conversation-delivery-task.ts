import {
  automationConversationDeliveryTasks,
  AutomationConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./errors.js";
import type { AutomationConversationPersistenceDependencies } from "./types.js";

export type EnqueueAutomationConversationDeliveryTaskInput = {
  conversationId: string;
  automationRunId: string;
  sourceWebhookEventId: string;
  sourceOrderKey: string;
};

export async function enqueueAutomationConversationDeliveryTask(
  ctx: AutomationConversationPersistenceDependencies,
  input: EnqueueAutomationConversationDeliveryTaskInput,
) {
  const insertedRows = await ctx.db
    .insert(automationConversationDeliveryTasks)
    .values({
      conversationId: input.conversationId,
      automationRunId: input.automationRunId,
      sourceWebhookEventId: input.sourceWebhookEventId,
      sourceOrderKey: input.sourceOrderKey,
      status: AutomationConversationDeliveryTaskStatuses.QUEUED,
    })
    .onConflictDoNothing({
      target: [automationConversationDeliveryTasks.automationRunId],
    })
    .returning();
  const insertedTask = insertedRows[0];
  if (insertedTask !== undefined) {
    return insertedTask;
  }

  const existingTask = await ctx.db.query.automationConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.automationRunId, input.automationRunId),
  });
  if (existingTask === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message:
        "AutomationConversation delivery task insert conflicted but no existing task row could be loaded.",
    });
  }

  if (
    existingTask.conversationId !== input.conversationId ||
    existingTask.sourceWebhookEventId !== input.sourceWebhookEventId ||
    existingTask.sourceOrderKey !== input.sourceOrderKey
  ) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message:
        "Existing conversation delivery task does not match the requested conversation, webhook event, or source order key.",
    });
  }

  return existingTask;
}
