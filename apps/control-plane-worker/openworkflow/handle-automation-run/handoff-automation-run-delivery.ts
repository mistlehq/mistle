import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import type { HandoffAutomationRunDeliveryInput } from "../shared/automation-run-types.js";
import { enqueueAutomationConversationDeliveryTask } from "../shared/enqueue-conversation-delivery-task.js";
import { ensureAutomationConversationDeliveryProcessor } from "../shared/ensure-conversation-delivery-processor.js";

export type HandoffAutomationRunDeliveryOutput = {
  conversationId: string;
  deliveryTaskId: string;
  generation: number;
  shouldStart: boolean;
};

export async function handoffAutomationRunDelivery(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: HandoffAutomationRunDeliveryInput,
): Promise<HandoffAutomationRunDeliveryOutput> {
  const enqueuedTask = await enqueueAutomationConversationDeliveryTask(
    {
      db: ctx.db,
    },
    {
      conversationId: input.preparedAutomationRun.conversationId,
      automationRunId: input.preparedAutomationRun.automationRunId,
      sourceWebhookEventId: input.preparedAutomationRun.sourceWebhookEventId,
      sourceScheduledActionId: input.preparedAutomationRun.sourceScheduledActionId,
      sourceOrderKey: input.preparedAutomationRun.sourceOrderKey,
    },
  );

  const deliveryProcessor = await ensureAutomationConversationDeliveryProcessor(
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
