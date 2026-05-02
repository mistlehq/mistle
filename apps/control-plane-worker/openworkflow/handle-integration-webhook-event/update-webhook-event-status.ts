import {
  IntegrationWebhookEventStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
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
  const tables = getControlPlaneDatabaseSchema(input.db);

  const updatedRows = await input.db
    .update(tables.integrationWebhookEvents)
    .set({
      status: input.status,
      finalizedAt: input.finalized ? sql`now()` : null,
    })
    .where(
      input.fromStatuses === undefined
        ? eq(tables.integrationWebhookEvents.id, input.webhookEventId)
        : and(
            eq(tables.integrationWebhookEvents.id, input.webhookEventId),
            inArray(tables.integrationWebhookEvents.status, [...input.fromStatuses]),
          ),
    )
    .returning({
      id: tables.integrationWebhookEvents.id,
    });

  return updatedRows[0] !== undefined;
}
