import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import type { HandoffAutomationRunDeliveryInput } from "../shared/automation-run-types.js";
import { enqueueAutomationConversationDeliveryTask } from "../shared/enqueue-conversation-delivery-task.js";
import { ensureAutomationConversationDeliveryProcessor } from "../shared/ensure-conversation-delivery-processor.js";

export type HandoffAutomationRunDeliveryOutput = {
  conversationId: string;
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
      sourceWebhookEventId: input.preparedAutomationRun.webhookEventId,
      sourceOrderKey: input.preparedAutomationRun.webhookSourceOrderKey,
    },
  );

  return ensureAutomationConversationDeliveryProcessor(
    {
      db: ctx.db,
    },
    {
      conversationId: enqueuedTask.conversationId,
    },
  );
}
