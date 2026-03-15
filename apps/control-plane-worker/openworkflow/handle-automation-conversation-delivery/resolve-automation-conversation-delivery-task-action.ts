import {
  type AutomationConversationDeliveryTask,
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "../../src/runtime/workflows/persistence/errors.js";
export const AutomationConversationDeliveryTaskActions = {
  DELIVER: "deliver",
  IGNORE: "ignore",
} as const;

export type AutomationConversationDeliveryTaskAction =
  (typeof AutomationConversationDeliveryTaskActions)[keyof typeof AutomationConversationDeliveryTaskActions];

type ActiveAutomationConversationDeliveryTask = Pick<
  AutomationConversationDeliveryTask,
  "id" | "conversationId" | "processorGeneration" | "sourceOrderKey" | "status"
>;

function assertTaskIsActiveForGeneration(input: {
  task: ActiveAutomationConversationDeliveryTask;
  generation: number;
}) {
  if (input.task.processorGeneration !== input.generation) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }

  if (
    input.task.status !== AutomationConversationDeliveryTaskStatuses.CLAIMED &&
    input.task.status !== AutomationConversationDeliveryTaskStatuses.DELIVERING
  ) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }
}

export async function resolveAutomationConversationDeliveryTaskAction(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: {
    taskId: string;
    generation: number;
  },
): Promise<AutomationConversationDeliveryTaskAction> {
  const task = await ctx.db.query.automationConversationDeliveryTasks.findFirst({
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
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `AutomationConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  assertTaskIsActiveForGeneration({
    task,
    generation: input.generation,
  });

  const conversation = await ctx.db.query.automationConversations.findFirst({
    columns: {
      id: true,
      lastProcessedSourceOrderKey: true,
    },
    where: (table, { eq }) => eq(table.id, task.conversationId),
  });
  if (conversation === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `AutomationConversation '${task.conversationId}' was not found for task '${task.id}'.`,
    });
  }

  if (
    conversation.lastProcessedSourceOrderKey !== null &&
    task.sourceOrderKey <= conversation.lastProcessedSourceOrderKey
  ) {
    return AutomationConversationDeliveryTaskActions.IGNORE;
  }

  return AutomationConversationDeliveryTaskActions.DELIVER;
}
