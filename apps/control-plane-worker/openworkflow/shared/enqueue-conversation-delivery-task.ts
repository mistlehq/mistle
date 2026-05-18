import {
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "./trigger-conversation-persistence-error.js";
export type EnqueueTriggerConversationDeliveryTaskInput = {
  conversationId: string;
  triggerRunId: string;
  sourceWebhookEventId?: string | undefined;
  sourceScheduledActionId?: string | undefined;
  sourceOrderKey: string;
};

export async function enqueueTriggerConversationDeliveryTask(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: EnqueueTriggerConversationDeliveryTaskInput,
) {
  if (
    (input.sourceWebhookEventId === undefined && input.sourceScheduledActionId === undefined) ||
    (input.sourceWebhookEventId !== undefined && input.sourceScheduledActionId !== undefined)
  ) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message: "TriggerConversation delivery task enqueue requires exactly one source reference.",
    });
  }
  const sourceWebhookEventId = input.sourceWebhookEventId ?? null;
  const sourceScheduledActionId = input.sourceScheduledActionId ?? null;
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const insertedRows = await ctx.db
    .insert(tables.triggerConversationDeliveryTasks)
    .values({
      conversationId: input.conversationId,
      triggerRunId: input.triggerRunId,
      sourceWebhookEventId,
      sourceScheduledActionId,
      sourceOrderKey: input.sourceOrderKey,
      status: TriggerConversationDeliveryTaskStatuses.QUEUED,
    })
    .onConflictDoNothing({
      target: [tables.triggerConversationDeliveryTasks.triggerRunId],
    })
    .returning();
  const insertedTask = insertedRows[0];
  if (insertedTask !== undefined) {
    return insertedTask;
  }

  const existingTask = await ctx.db.query.triggerConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.triggerRunId, input.triggerRunId),
  });
  if (existingTask === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message:
        "TriggerConversation delivery task insert conflicted but no existing task row could be loaded.",
    });
  }

  if (
    existingTask.conversationId !== input.conversationId ||
    existingTask.sourceWebhookEventId !== sourceWebhookEventId ||
    existingTask.sourceScheduledActionId !== sourceScheduledActionId ||
    existingTask.sourceOrderKey !== input.sourceOrderKey
  ) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message:
        "Existing conversation delivery task does not match the requested conversation, webhook event, or source order key.",
    });
  }

  return existingTask;
}
