import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationTargets } from "./integration-targets.js";
import { controlPlaneSchema } from "./namespace.js";

export const IntegrationWebhookEventStatuses = {
  RECEIVED: "received",
  PROCESSING: "processing",
  PROCESSED: "processed",
  FAILED: "failed",
  IGNORED: "ignored",
  DUPLICATE: "duplicate",
} as const;

export type IntegrationWebhookEventStatus =
  (typeof IntegrationWebhookEventStatuses)[keyof typeof IntegrationWebhookEventStatuses];

export const integrationWebhookEvents = controlPlaneSchema.table(
  "integration_webhook_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("iwe").toString()),
    targetKey: text("target_key")
      .notNull()
      .references(() => integrationTargets.targetKey, { onDelete: "restrict" }),
    externalEventId: text("external_event_id").notNull(),
    externalDeliveryId: text("external_delivery_id"),
    eventType: text("event_type").notNull(),
    providerEventType: text("provider_event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .notNull()
      .$type<IntegrationWebhookEventStatus>()
      .default(IntegrationWebhookEventStatuses.RECEIVED),
    finalizedAt: timestamp("finalized_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("integration_webhook_events_target_key_external_event_id_uidx").on(
      table.targetKey,
      table.externalEventId,
    ),
    index("integration_webhook_events_target_key_idx").on(table.targetKey),
    index("integration_webhook_events_status_idx").on(table.status),
    index("integration_webhook_events_event_type_idx").on(table.eventType),
    index("integration_webhook_events_external_delivery_id_idx").on(table.externalDeliveryId),
  ],
);

export type IntegrationWebhookEvent = typeof integrationWebhookEvents.$inferSelect;
export type InsertIntegrationWebhookEvent = typeof integrationWebhookEvents.$inferInsert;
