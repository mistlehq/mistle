import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { integrationTargets } from "./integration-targets.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

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
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    integrationConnectionId: text("integration_connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    targetKey: text("target_key")
      .notNull()
      .references(() => integrationTargets.targetKey, { onDelete: "restrict" }),
    externalEventId: text("external_event_id").notNull(),
    externalDeliveryId: text("external_delivery_id"),
    eventType: text("event_type").notNull(),
    providerEventType: text("provider_event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sourceOccurredAt: timestamp("source_occurred_at", { withTimezone: true, mode: "string" }),
    sourceOrderKey: text("source_order_key"),
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
    index("integration_webhook_events_organization_id_idx").on(table.organizationId),
    index("integration_webhook_events_integration_connection_id_idx").on(
      table.integrationConnectionId,
    ),
    index("integration_webhook_events_target_key_idx").on(table.targetKey),
    index("integration_webhook_events_status_idx").on(table.status),
    index("integration_webhook_events_event_type_idx").on(table.eventType),
    index("integration_webhook_events_external_delivery_id_idx").on(table.externalDeliveryId),
    index("integration_webhook_events_source_order_key_idx").on(table.sourceOrderKey),
  ],
);

export type IntegrationWebhookEvent = typeof integrationWebhookEvents.$inferSelect;
export type InsertIntegrationWebhookEvent = typeof integrationWebhookEvents.$inferInsert;
