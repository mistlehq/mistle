import { index, jsonb, text, timestamp } from "drizzle-orm/pg-core";

import { automations } from "./automations.js";
import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";

export const webhookAutomations = controlPlaneSchema.table(
  "webhook_automations",
  {
    automationId: text("automation_id")
      .primaryKey()
      .references(() => automations.id, { onDelete: "cascade" }),
    integrationConnectionId: text("integration_connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    eventTypes: jsonb("event_types").$type<string[]>(),
    payloadFilter: jsonb("payload_filter").$type<Record<string, unknown>>(),
    inputTemplate: text("input_template").notNull(),
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
    index("webhook_automations_integration_connection_id_idx").on(table.integrationConnectionId),
    index("webhook_automations_automation_id_idx").on(table.automationId),
  ],
);

export type WebhookAutomation = typeof webhookAutomations.$inferSelect;
export type InsertWebhookAutomation = typeof webhookAutomations.$inferInsert;
