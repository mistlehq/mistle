import { AutomationConversationDeliveryTaskStatuses } from "@mistle/db/control-plane";

import {
  claimNextAutomationConversationDeliveryTask,
  findActiveAutomationConversationDeliveryTask,
} from "./delivery-tasks.js";
import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./error.js";
import type {
  ActiveAutomationConversationDeliveryTask,
  HandleAutomationConversationDeliveryDependencies,
  HandleAutomationConversationDeliveryWorkflowInput,
} from "./types.js";

export async function claimOrResumeAutomationConversationDeliveryTask(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: HandleAutomationConversationDeliveryWorkflowInput,
): Promise<ActiveAutomationConversationDeliveryTask | null> {
  const activeTask = await findActiveAutomationConversationDeliveryTask(
    {
      db: ctx.db,
    },
    {
      conversationId: input.conversationId,
      generation: input.generation,
    },
  );
  if (activeTask !== undefined) {
    if (activeTask.status === AutomationConversationDeliveryTaskStatuses.CLAIMED) {
      return {
        taskId: activeTask.id,
        automationRunId: activeTask.automationRunId,
        status: "claimed",
      };
    }

    if (activeTask.status === AutomationConversationDeliveryTaskStatuses.DELIVERING) {
      return {
        taskId: activeTask.id,
        automationRunId: activeTask.automationRunId,
        status: "delivering",
      };
    }

    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${activeTask.id}' is in unexpected active status '${activeTask.status}'.`,
    });
  }

  const claimedTask = await claimNextAutomationConversationDeliveryTask(
    {
      db: ctx.db,
    },
    {
      conversationId: input.conversationId,
      generation: input.generation,
    },
  );
  if (claimedTask === null) {
    return null;
  }

  return {
    taskId: claimedTask.id,
    automationRunId: claimedTask.automationRunId,
    status: "claimed",
  };
}
