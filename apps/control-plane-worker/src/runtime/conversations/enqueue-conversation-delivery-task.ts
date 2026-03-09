import {
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type EnqueueConversationDeliveryTaskInput = {
  conversationId: string;
  automationRunId: string;
  sourceWebhookEventId: string;
  sourceOrderKey: string;
};

export async function enqueueConversationDeliveryTask(
  deps: ConversationPersistenceDependencies,
  input: EnqueueConversationDeliveryTaskInput,
) {
  const insertedRows = await deps.db
    .insert(conversationDeliveryTasks)
    .values({
      conversationId: input.conversationId,
      automationRunId: input.automationRunId,
      sourceWebhookEventId: input.sourceWebhookEventId,
      sourceOrderKey: input.sourceOrderKey,
      status: ConversationDeliveryTaskStatuses.QUEUED,
    })
    .onConflictDoNothing({
      target: [conversationDeliveryTasks.automationRunId],
    })
    .returning();
  const insertedTask = insertedRows[0];
  if (insertedTask !== undefined) {
    return insertedTask;
  }

  const existingTask = await deps.db.query.conversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.automationRunId, input.automationRunId),
  });
  if (existingTask === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message:
        "Conversation delivery task insert conflicted but no existing task row could be loaded.",
    });
  }

  if (
    existingTask.conversationId !== input.conversationId ||
    existingTask.sourceWebhookEventId !== input.sourceWebhookEventId ||
    existingTask.sourceOrderKey !== input.sourceOrderKey
  ) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message:
        "Existing conversation delivery task does not match the requested conversation, webhook event, or source order key.",
    });
  }

  return existingTask;
}
