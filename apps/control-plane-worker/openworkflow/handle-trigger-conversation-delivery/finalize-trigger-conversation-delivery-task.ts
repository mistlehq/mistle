import {
  TriggerConversationDeliveryTaskStatuses,
  type TriggerConversationDeliveryTaskStatus,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, or, sql } from "drizzle-orm";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "../shared/trigger-conversation-persistence-error.js";
const FinalTriggerConversationDeliveryTaskStatuses = new Set<TriggerConversationDeliveryTaskStatus>(
  [
    TriggerConversationDeliveryTaskStatuses.COMPLETED,
    TriggerConversationDeliveryTaskStatuses.FAILED,
    TriggerConversationDeliveryTaskStatuses.IGNORED,
  ],
);

export type FinalizeTriggerConversationDeliveryTaskInput = {
  taskId: string;
  generation: number;
  status: TriggerConversationDeliveryTaskStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
};

export async function finalizeTriggerConversationDeliveryTask(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: FinalizeTriggerConversationDeliveryTaskInput,
) {
  if (!FinalTriggerConversationDeliveryTaskStatuses.has(input.status)) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message: `TriggerConversation delivery task status '${input.status}' is not terminal.`,
    });
  }

  return ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const updatedRows = await tx
      .update(tables.triggerConversationDeliveryTasks)
      .set({
        status: input.status,
        failureCode: input.failureCode ?? null,
        failureMessage: input.failureMessage ?? null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(tables.triggerConversationDeliveryTasks.id, input.taskId),
          eq(tables.triggerConversationDeliveryTasks.processorGeneration, input.generation),
          or(
            eq(
              tables.triggerConversationDeliveryTasks.status,
              TriggerConversationDeliveryTaskStatuses.CLAIMED,
            ),
            eq(
              tables.triggerConversationDeliveryTasks.status,
              TriggerConversationDeliveryTaskStatuses.DELIVERING,
            ),
          ),
        ),
      )
      .returning();
    const updatedTask = updatedRows[0];
    if (updatedTask !== undefined) {
      if (input.status === TriggerConversationDeliveryTaskStatuses.COMPLETED) {
        await tx
          .update(tables.triggerConversations)
          .set({
            lastProcessedSourceOrderKey: updatedTask.sourceOrderKey,
            lastProcessedWebhookEventId: updatedTask.sourceWebhookEventId,
            updatedAt: sql`now()`,
            lastActivityAt: sql`now()`,
          })
          .where(eq(tables.triggerConversations.id, updatedTask.conversationId));
      }

      return updatedTask;
    }

    const existingTask = await tx.query.triggerConversationDeliveryTasks.findFirst({
      where: (table, { eq }) => eq(table.id, input.taskId),
    });
    if (existingTask === undefined) {
      throw new TriggerConversationPersistenceError({
        code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
        message: `TriggerConversation delivery task '${input.taskId}' was not found.`,
      });
    }

    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `TriggerConversation delivery task '${input.taskId}' is not active for generation '${input.generation}'.`,
    });
  });
}
