import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { enqueueTriggerConversationDeliveryTask } from "../shared/enqueue-conversation-delivery-task.js";
import { ensureTriggerConversationDeliveryProcessor } from "../shared/ensure-conversation-delivery-processor.js";
import type { HandoffTriggerRunDeliveryInput } from "../shared/trigger-run-types.js";

export type HandoffTriggerRunDeliveryOutput = {
  conversationId: string;
  deliveryTaskId: string;
  generation: number;
  shouldStart: boolean;
};

export async function handoffTriggerRunDelivery(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: HandoffTriggerRunDeliveryInput,
): Promise<HandoffTriggerRunDeliveryOutput> {
  const enqueuedTask = await enqueueTriggerConversationDeliveryTask(
    {
      db: ctx.db,
    },
    {
      conversationId: input.preparedTriggerRun.conversationId,
      triggerRunId: input.preparedTriggerRun.triggerRunId,
      sourceWebhookEventId: input.preparedTriggerRun.sourceWebhookEventId,
      sourceScheduledActionId: input.preparedTriggerRun.sourceScheduledActionId,
      sourceOrderKey: input.preparedTriggerRun.sourceOrderKey,
    },
  );

  const deliveryProcessor = await ensureTriggerConversationDeliveryProcessor(
    {
      db: ctx.db,
    },
    {
      conversationId: enqueuedTask.conversationId,
    },
  );

  return {
    conversationId: deliveryProcessor.conversationId,
    deliveryTaskId: enqueuedTask.id,
    generation: deliveryProcessor.generation,
    shouldStart: deliveryProcessor.shouldStart,
  };
}
