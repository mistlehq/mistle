import { index, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { automationRuns } from "./automation-runs.js";
import { conversations } from "./conversations.js";
import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";

export const ConversationDeliveryTaskStatuses = {
  QUEUED: "queued",
  CLAIMED: "claimed",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  FAILED: "failed",
  IGNORED: "ignored",
} as const;

export type ConversationDeliveryTaskStatus =
  (typeof ConversationDeliveryTaskStatuses)[keyof typeof ConversationDeliveryTaskStatuses];

export const conversationDeliveryTasks = controlPlaneSchema.table(
  "conversation_delivery_tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cdt").toString()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    automationRunId: text("automation_run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    sourceWebhookEventId: text("source_webhook_event_id")
      .notNull()
      .references(() => integrationWebhookEvents.id, { onDelete: "cascade" }),
    sourceOrderKey: text("source_order_key").notNull(),
    processorGeneration: integer("processor_generation"),
    status: text("status")
      .notNull()
      .$type<ConversationDeliveryTaskStatus>()
      .default(ConversationDeliveryTaskStatuses.QUEUED),
    attemptCount: integer("attempt_count").notNull().default(0),
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
    uniqueIndex("conversation_delivery_tasks_automation_run_id_uidx").on(table.automationRunId),
    index("conversation_delivery_tasks_conversation_id_idx").on(table.conversationId),
    index("conversation_delivery_tasks_source_webhook_event_id_idx").on(table.sourceWebhookEventId),
    index("conversation_delivery_tasks_status_idx").on(table.status),
    index("conversation_delivery_tasks_dequeue_idx").on(
      table.conversationId,
      table.status,
      table.sourceOrderKey,
      table.createdAt,
      table.id,
    ),
  ],
);

export type ConversationDeliveryTask = typeof conversationDeliveryTasks.$inferSelect;
export type InsertConversationDeliveryTask = typeof conversationDeliveryTasks.$inferInsert;
