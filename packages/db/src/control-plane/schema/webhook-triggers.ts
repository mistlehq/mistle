import { sql } from "drizzle-orm";
import { check, index, jsonb, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { integrationWebhookSources } from "./integration-webhook-sources.js";
import { controlPlaneSchema } from "./namespace.js";
import { triggers } from "./triggers.js";

export type WebhookTriggerEventCondition = {
  eventType: string;
  payloadFilter?: Record<string, unknown> | null | undefined;
};

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
      eventConditions: jsonb("event_conditions").$type<WebhookTriggerEventCondition[]>().notNull(),
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
      check(
        "webhook_triggers_event_conditions_non_empty_check",
        sql`jsonb_typeof(${table.eventConditions}) = 'array' and jsonb_array_length(${table.eventConditions}) > 0`,
      ),
    ],
  );
}

export const webhookTriggers = defineWebhookTriggers(controlPlaneSchema);

export type WebhookTrigger = typeof webhookTriggers.$inferSelect;
export type InsertWebhookTrigger = typeof webhookTriggers.$inferInsert;
