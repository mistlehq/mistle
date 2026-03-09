import {
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
  type ConversationDeliveryTaskStatus,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

const FinalConversationDeliveryTaskStatuses = new Set<ConversationDeliveryTaskStatus>([
  ConversationDeliveryTaskStatuses.COMPLETED,
  ConversationDeliveryTaskStatuses.FAILED,
  ConversationDeliveryTaskStatuses.IGNORED,
]);

export type FinalizeConversationDeliveryTaskInput = {
  taskId: string;
  status: ConversationDeliveryTaskStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
};

export async function finalizeConversationDeliveryTask(
  deps: ConversationPersistenceDependencies,
  input: FinalizeConversationDeliveryTaskInput,
) {
  if (!FinalConversationDeliveryTaskStatuses.has(input.status)) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message: `Conversation delivery task status '${input.status}' is not terminal.`,
    });
  }

  const updatedRows = await deps.db
    .update(conversationDeliveryTasks)
    .set({
      status: input.status,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(conversationDeliveryTasks.id, input.taskId),
        eq(conversationDeliveryTasks.status, ConversationDeliveryTaskStatuses.PROCESSING),
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
    code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_PROCESSING,
    message: `Conversation delivery task '${input.taskId}' is not in processing status.`,
  });
}
