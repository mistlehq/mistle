import { index, jsonb, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { integrationWebhookSources } from "./integration-webhook-sources.js";
import { controlPlaneSchema } from "./namespace.js";
import { triggers } from "./triggers.js";

export function defineWebhookTriggers(schema: PgSchema) {
  return schema.table(
    "webhook_triggers",
    {
      triggerId: text("trigger_id")
        .primaryKey()
        .references(() => triggers.id, { onDelete: "cascade" }),
      integrationWebhookSourceId: text("integration_webhook_source_id")
        .notNull()
        .references(() => integrationWebhookSources.id, { onDelete: "cascade" }),
      eventTypes: jsonb("event_types").$type<string[]>(),
      payloadFilter: jsonb("payload_filter").$type<Record<string, unknown>>(),
      inputTemplate: text("input_template").notNull(),
      instructions: text("instructions"),
      conversationKeyTemplate: text("conversation_key_template").notNull(),
      idempotencyKeyTemplate: text("idempotency_key_template"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("webhook_triggers_integration_webhook_source_id_idx").on(
        table.integrationWebhookSourceId,
      ),
    ],
  );
}

export const webhookTriggers = defineWebhookTriggers(controlPlaneSchema);

export type WebhookTrigger = typeof webhookTriggers.$inferSelect;
export type InsertWebhookTrigger = typeof webhookTriggers.$inferInsert;
