import {
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function updateWebhookEventStatus(input: {
  db: ControlPlaneDatabase;
  webhookEventId: string;
  status: (typeof IntegrationWebhookEventStatuses)[keyof typeof IntegrationWebhookEventStatuses];
  finalized: boolean;
  fromStatuses?: ReadonlyArray<
    (typeof IntegrationWebhookEventStatuses)[keyof typeof IntegrationWebhookEventStatuses]
  >;
}): Promise<boolean> {
  const updatedRows = await input.db
    .update(integrationWebhookEvents)
    .set({
      status: input.status,
      finalizedAt: input.finalized ? sql`now()` : null,
    })
    .where(
      input.fromStatuses === undefined
        ? eq(integrationWebhookEvents.id, input.webhookEventId)
        : and(
            eq(integrationWebhookEvents.id, input.webhookEventId),
            inArray(integrationWebhookEvents.status, [...input.fromStatuses]),
          ),
    )
    .returning({
      id: integrationWebhookEvents.id,
    });

  return updatedRows[0] !== undefined;
}
