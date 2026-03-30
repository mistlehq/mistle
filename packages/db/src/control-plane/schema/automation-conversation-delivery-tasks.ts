import { bigint, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { automationConversations } from "./automation-conversations.js";
import { automationRuns } from "./automation-runs.js";
import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";

export const AutomationConversationDeliveryTaskStatuses = {
  QUEUED: "queued",
  CLAIMED: "claimed",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  FAILED: "failed",
  IGNORED: "ignored",
} as const;

export type AutomationConversationDeliveryTaskStatus =
  (typeof AutomationConversationDeliveryTaskStatuses)[keyof typeof AutomationConversationDeliveryTaskStatuses];

export const automationConversationDeliveryTasks = controlPlaneSchema.table(
  "automation_conversation_delivery_tasks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cdt").toString()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => automationConversations.id, { onDelete: "cascade" }),
    automationRunId: text("automation_run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),
    sourceWebhookEventId: text("source_webhook_event_id")
      .notNull()
      .references(() => integrationWebhookEvents.id, { onDelete: "cascade" }),
    sourceOrderKey: text("source_order_key").notNull(),
    processorGeneration: bigint("processor_generation", { mode: "number" }),
    status: text("status")
      .notNull()
      .$type<AutomationConversationDeliveryTaskStatus>()
      .default(AutomationConversationDeliveryTaskStatuses.QUEUED),
    attemptCount: bigint("attempt_count", { mode: "number" }).notNull().default(0),
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
    uniqueIndex("automation_conversation_delivery_tasks_automation_run_id_uidx").on(
      table.automationRunId,
    ),
    index("automation_conversation_delivery_tasks_automation_conversation_id_idx").on(
      table.conversationId,
    ),
    index("automation_conversation_delivery_tasks_source_webhook_event_id_idx").on(
      table.sourceWebhookEventId,
    ),
    index("automation_conversation_delivery_tasks_status_idx").on(table.status),
    index("automation_conversation_delivery_tasks_dequeue_idx").on(
      table.conversationId,
      table.status,
      table.sourceOrderKey,
      table.createdAt,
      table.id,
    ),
  ],
);

export type AutomationConversationDeliveryTask =
  typeof automationConversationDeliveryTasks.$inferSelect;
export type InsertAutomationConversationDeliveryTask =
  typeof automationConversationDeliveryTasks.$inferInsert;
