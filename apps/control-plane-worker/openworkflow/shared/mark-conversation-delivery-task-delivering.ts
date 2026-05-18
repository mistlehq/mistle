import {
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "./trigger-conversation-persistence-error.js";
export type MarkTriggerConversationDeliveryTaskDeliveringInput = {
  taskId: string;
  generation: number;
};

export async function markTriggerConversationDeliveryTaskDelivering(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: MarkTriggerConversationDeliveryTaskDeliveringInput,
) {
  const tables = getControlPlaneDatabaseSchema(deps.db);

  const updatedRows = await deps.db
    .update(tables.triggerConversationDeliveryTasks)
    .set({
      status: TriggerConversationDeliveryTaskStatuses.DELIVERING,
      deliveryStartedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.triggerConversationDeliveryTasks.id, input.taskId),
        eq(tables.triggerConversationDeliveryTasks.processorGeneration, input.generation),
        eq(
          tables.triggerConversationDeliveryTasks.status,
          TriggerConversationDeliveryTaskStatuses.CLAIMED,
        ),
      ),
    )
    .returning();
  const updatedTask = updatedRows[0];
  if (updatedTask !== undefined) {
    return updatedTask;
  }

  const existingTask = await deps.db.query.triggerConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (existingTask === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `TriggerConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  throw new TriggerConversationPersistenceError({
    code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
    message: `TriggerConversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
  });
}
