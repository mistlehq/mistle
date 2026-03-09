import {
  type ConversationDeliveryTask,
  ConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export const ConversationDeliveryTaskActions = {
  DELIVER: "deliver",
  IGNORE: "ignore",
} as const;

export type ConversationDeliveryTaskAction =
  (typeof ConversationDeliveryTaskActions)[keyof typeof ConversationDeliveryTaskActions];

type ActiveConversationDeliveryTask = Pick<
  ConversationDeliveryTask,
  "id" | "conversationId" | "processorGeneration" | "sourceOrderKey" | "status"
>;

function assertTaskIsActiveForGeneration(input: {
  task: ActiveConversationDeliveryTask;
  generation: number;
}) {
  if (input.task.processorGeneration !== input.generation) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `Conversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }

  if (
    input.task.status !== ConversationDeliveryTaskStatuses.CLAIMED &&
    input.task.status !== ConversationDeliveryTaskStatuses.DELIVERING
  ) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `Conversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }
}

export async function resolveConversationDeliveryTaskAction(
  deps: ConversationPersistenceDependencies,
  input: {
    taskId: string;
    generation: number;
  },
): Promise<ConversationDeliveryTaskAction> {
  const task = await deps.db.query.conversationDeliveryTasks.findFirst({
    columns: {
      id: true,
      conversationId: true,
      processorGeneration: true,
      sourceOrderKey: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (task === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `Conversation delivery task '${input.taskId}' was not found.`,
    });
  }

  assertTaskIsActiveForGeneration({
    task,
    generation: input.generation,
  });

  const conversation = await deps.db.query.conversations.findFirst({
    columns: {
      id: true,
      lastProcessedSourceOrderKey: true,
    },
    where: (table, { eq }) => eq(table.id, task.conversationId),
  });
  if (conversation === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `Conversation '${task.conversationId}' was not found for task '${task.id}'.`,
    });
  }

  if (
    conversation.lastProcessedSourceOrderKey !== null &&
    task.sourceOrderKey <= conversation.lastProcessedSourceOrderKey
  ) {
    return ConversationDeliveryTaskActions.IGNORE;
  }

  return ConversationDeliveryTaskActions.DELIVER;
}
