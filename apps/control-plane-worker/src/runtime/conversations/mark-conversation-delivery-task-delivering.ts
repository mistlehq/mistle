import {
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type MarkConversationDeliveryTaskDeliveringInput = {
  taskId: string;
  generation: number;
};

export async function markConversationDeliveryTaskDelivering(
  deps: ConversationPersistenceDependencies,
  input: MarkConversationDeliveryTaskDeliveringInput,
) {
  const updatedRows = await deps.db
    .update(conversationDeliveryTasks)
    .set({
      status: ConversationDeliveryTaskStatuses.DELIVERING,
      deliveryStartedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(conversationDeliveryTasks.id, input.taskId),
        eq(conversationDeliveryTasks.processorGeneration, input.generation),
        eq(conversationDeliveryTasks.status, ConversationDeliveryTaskStatuses.CLAIMED),
      ),
    )
    .returning();
  const updatedTask = updatedRows[0];
  if (updatedTask !== undefined) {
    return updatedTask;
  }

  const existingTask = await deps.db.query.conversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (existingTask === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `Conversation delivery task '${input.taskId}' was not found.`,
    });
  }

  throw new ConversationPersistenceError({
    code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
    message: `Conversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
  });
}
