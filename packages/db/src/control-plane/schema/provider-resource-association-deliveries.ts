import { bigint, index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";
import { providerResourceAssociations } from "./provider-resource-associations.js";

export const ProviderResourceAssociationDeliveryStatuses = {
  QUEUED: "queued",
  CLAIMED: "claimed",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  FAILED: "failed",
  IGNORED: "ignored",
} as const;

export type ProviderResourceAssociationDeliveryStatus =
  (typeof ProviderResourceAssociationDeliveryStatuses)[keyof typeof ProviderResourceAssociationDeliveryStatuses];

export function defineProviderResourceAssociationDeliveries(schema: PgSchema) {
  return schema.table(
    "provider_resource_association_deliveries",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("prd").toString()),
      providerResourceAssociationId: text("provider_resource_association_id")
        .notNull()
        .references(() => providerResourceAssociations.id, { onDelete: "cascade" }),
      sourceWebhookEventId: text("source_webhook_event_id")
        .notNull()
        .references(() => integrationWebhookEvents.id, { onDelete: "cascade" }),
      sourceOrderKey: text("source_order_key").notNull(),
      renderedInput: text("rendered_input").notNull(),
      status: text("status")
        .notNull()
        .$type<ProviderResourceAssociationDeliveryStatus>()
        .default(ProviderResourceAssociationDeliveryStatuses.QUEUED),
      attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
      processorGeneration: bigint("processor_generation", { mode: "number" }),
      failureCode: text("failure_code"),
      failureMessage: text("failure_message"),
      claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }),
      deliveryStartedAt: timestamp("delivery_started_at", {
        withTimezone: true,
        mode: "string",
      }),
      finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("provider_resource_association_deliveries_event_uidx").on(
        table.providerResourceAssociationId,
        table.sourceWebhookEventId,
      ),
      index("provider_resource_association_deliveries_dequeue_idx").on(
        table.providerResourceAssociationId,
        table.status,
        table.sourceOrderKey,
        table.createdAt,
        table.id,
      ),
      index("provider_resource_association_deliveries_webhook_event_id_idx").on(
        table.sourceWebhookEventId,
      ),
      index("provider_resource_association_deliveries_status_idx").on(table.status),
    ],
  );
}

export const providerResourceAssociationDeliveries =
  defineProviderResourceAssociationDeliveries(controlPlaneSchema);

export type ProviderResourceAssociationDelivery =
  typeof providerResourceAssociationDeliveries.$inferSelect;
export type InsertProviderResourceAssociationDelivery =
  typeof providerResourceAssociationDeliveries.$inferInsert;
