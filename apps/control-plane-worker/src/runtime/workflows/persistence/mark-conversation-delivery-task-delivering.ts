import {
  automationConversationDeliveryTasks,
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./errors.js";
export type MarkAutomationConversationDeliveryTaskDeliveringInput = {
  taskId: string;
  generation: number;
};

export async function markAutomationConversationDeliveryTaskDelivering(
  deps: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: MarkAutomationConversationDeliveryTaskDeliveringInput,
) {
  const updatedRows = await deps.db
    .update(automationConversationDeliveryTasks)
    .set({
      status: AutomationConversationDeliveryTaskStatuses.DELIVERING,
      deliveryStartedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationConversationDeliveryTasks.id, input.taskId),
        eq(automationConversationDeliveryTasks.processorGeneration, input.generation),
        eq(
          automationConversationDeliveryTasks.status,
          AutomationConversationDeliveryTaskStatuses.CLAIMED,
        ),
      ),
    )
    .returning();
  const updatedTask = updatedRows[0];
  if (updatedTask !== undefined) {
    return updatedTask;
  }

  const existingTask = await deps.db.query.automationConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (existingTask === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `AutomationConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  throw new AutomationConversationPersistenceError({
    code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
    message: `AutomationConversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
  });
}
