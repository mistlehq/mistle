import {
  IntegrationWebhookEventStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import { updateWebhookEventStatus } from "./update-webhook-event-status.js";

export async function markIntegrationWebhookEventFailed(
  ctx: { db: ControlPlaneDatabase },
  input: { webhookEventId: string },
): Promise<void> {
  await updateWebhookEventStatus({
    db: ctx.db,
    webhookEventId: input.webhookEventId,
    status: IntegrationWebhookEventStatuses.FAILED,
    finalized: true,
  });
}
