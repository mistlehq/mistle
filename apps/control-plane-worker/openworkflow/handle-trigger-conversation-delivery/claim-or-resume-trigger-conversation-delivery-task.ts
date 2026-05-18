import {
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { HandleTriggerConversationDeliveryWorkflowInput } from "@mistle/workflow-registry/control-plane";

import { claimNextTriggerConversationDeliveryTask } from "../shared/claim-next-conversation-delivery-task.js";
import { findActiveTriggerConversationDeliveryTask } from "../shared/find-active-conversation-delivery-task.js";
import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "../shared/trigger-conversation-persistence-error.js";
import type { ActiveTriggerConversationDeliveryTask } from "./types.js";

export async function claimOrResumeTriggerConversationDeliveryTask(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: HandleTriggerConversationDeliveryWorkflowInput,
): Promise<ActiveTriggerConversationDeliveryTask | null> {
  const activeTask = await findActiveTriggerConversationDeliveryTask(
    {
      db: ctx.db,
    },
    {
      conversationId: input.conversationId,
      generation: input.generation,
    },
  );
  if (activeTask !== undefined) {
    if (activeTask.status === TriggerConversationDeliveryTaskStatuses.CLAIMED) {
      return {
        taskId: activeTask.id,
        triggerRunId: activeTask.triggerRunId,
        status: "claimed",
        attemptCount: activeTask.attemptCount,
        processorGeneration: activeTask.processorGeneration,
      };
    }

    if (activeTask.status === TriggerConversationDeliveryTaskStatuses.DELIVERING) {
      return {
        taskId: activeTask.id,
        triggerRunId: activeTask.triggerRunId,
        status: "delivering",
        attemptCount: activeTask.attemptCount,
        processorGeneration: activeTask.processorGeneration,
      };
    }

    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `TriggerConversation delivery task '${activeTask.id}' is in unexpected active status '${activeTask.status}'.`,
    });
  }

  const claimedTask = await claimNextTriggerConversationDeliveryTask(
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
    triggerRunId: claimedTask.triggerRunId,
    status: "claimed",
    attemptCount: claimedTask.attemptCount,
    processorGeneration: claimedTask.processorGeneration,
  };
}
