import {
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./automation-conversation-persistence-error.js";
export type EnqueueAutomationConversationDeliveryTaskInput = {
  conversationId: string;
  automationRunId: string;
  sourceWebhookEventId?: string | undefined;
  sourceScheduledActionId?: string | undefined;
  sourceOrderKey: string;
};

export async function enqueueAutomationConversationDeliveryTask(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: EnqueueAutomationConversationDeliveryTaskInput,
) {
  if (
    (input.sourceWebhookEventId === undefined && input.sourceScheduledActionId === undefined) ||
    (input.sourceWebhookEventId !== undefined && input.sourceScheduledActionId !== undefined)
  ) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message:
        "AutomationConversation delivery task enqueue requires exactly one source reference.",
    });
  }
  const sourceWebhookEventId = input.sourceWebhookEventId ?? null;
  const sourceScheduledActionId = input.sourceScheduledActionId ?? null;
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const insertedRows = await ctx.db
    .insert(tables.automationConversationDeliveryTasks)
    .values({
      conversationId: input.conversationId,
      automationRunId: input.automationRunId,
      sourceWebhookEventId,
      sourceScheduledActionId,
      sourceOrderKey: input.sourceOrderKey,
      status: AutomationConversationDeliveryTaskStatuses.QUEUED,
    })
    .onConflictDoNothing({
      target: [tables.automationConversationDeliveryTasks.automationRunId],
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
    existingTask.sourceWebhookEventId !== sourceWebhookEventId ||
    existingTask.sourceScheduledActionId !== sourceScheduledActionId ||
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
