import {
  type TriggerConversationDeliveryTask,
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "../shared/trigger-conversation-persistence-error.js";
export const TriggerConversationDeliveryTaskActions = {
  DELIVER: "deliver",
  IGNORE: "ignore",
} as const;

export type TriggerConversationDeliveryTaskAction =
  (typeof TriggerConversationDeliveryTaskActions)[keyof typeof TriggerConversationDeliveryTaskActions];

type ActiveTriggerConversationDeliveryTask = Pick<
  TriggerConversationDeliveryTask,
  "id" | "conversationId" | "processorGeneration" | "sourceOrderKey" | "status"
>;

function assertTaskIsActiveForGeneration(input: {
  task: ActiveTriggerConversationDeliveryTask;
  generation: number;
}) {
  if (input.task.processorGeneration !== input.generation) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `TriggerConversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }

  if (
    input.task.status !== TriggerConversationDeliveryTaskStatuses.CLAIMED &&
    input.task.status !== TriggerConversationDeliveryTaskStatuses.DELIVERING
  ) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `TriggerConversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }
}

export async function resolveTriggerConversationDeliveryTaskAction(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    taskId: string;
    generation: number;
  },
): Promise<TriggerConversationDeliveryTaskAction> {
  const task = await ctx.db.query.triggerConversationDeliveryTasks.findFirst({
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
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `TriggerConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  assertTaskIsActiveForGeneration({
    task,
    generation: input.generation,
  });

  const conversation = await ctx.db.query.triggerConversations.findFirst({
    columns: {
      id: true,
      lastProcessedSourceOrderKey: true,
    },
    where: (table, { eq }) => eq(table.id, task.conversationId),
  });
  if (conversation === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `TriggerConversation '${task.conversationId}' was not found for task '${task.id}'.`,
    });
  }

  if (
    conversation.lastProcessedSourceOrderKey !== null &&
    task.sourceOrderKey <= conversation.lastProcessedSourceOrderKey
  ) {
    return TriggerConversationDeliveryTaskActions.IGNORE;
  }

  return TriggerConversationDeliveryTaskActions.DELIVER;
}
