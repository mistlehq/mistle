import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  type PgSchema,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";
import { scheduledActions } from "./scheduled-actions.js";
import { triggerConversations } from "./trigger-conversations.js";
import { triggerRuns } from "./trigger-runs.js";

export const TriggerConversationDeliveryTaskStatuses = {
  QUEUED: "queued",
  CLAIMED: "claimed",
  DELIVERING: "delivering",
  COMPLETED: "completed",
  FAILED: "failed",
  IGNORED: "ignored",
} as const;

export type TriggerConversationDeliveryTaskStatus =
  (typeof TriggerConversationDeliveryTaskStatuses)[keyof typeof TriggerConversationDeliveryTaskStatuses];

export function defineTriggerConversationDeliveryTasks(schema: PgSchema) {
  return schema.table(
    "trigger_conversation_delivery_tasks",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("cdt").toString()),
      conversationId: text("conversation_id")
        .notNull()
        .references(() => triggerConversations.id, { onDelete: "cascade" }),
      triggerRunId: text("trigger_run_id")
        .notNull()
        .references(() => triggerRuns.id, { onDelete: "cascade" }),
      sourceWebhookEventId: text("source_webhook_event_id").references(
        () => integrationWebhookEvents.id,
        { onDelete: "cascade" },
      ),
      sourceScheduledActionId: text("source_scheduled_action_id").references(
        () => scheduledActions.id,
        { onDelete: "cascade" },
      ),
      sourceOrderKey: text("source_order_key").notNull(),
      processorGeneration: bigint("processor_generation", { mode: "number" }),
      status: text("status")
        .notNull()
        .$type<TriggerConversationDeliveryTaskStatus>()
        .default(TriggerConversationDeliveryTaskStatuses.QUEUED),
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
      uniqueIndex("trigger_conversation_delivery_tasks_trigger_run_id_uidx").on(table.triggerRunId),
      index("trigger_conversation_delivery_tasks_source_webhook_event_id_idx").on(
        table.sourceWebhookEventId,
      ),
      index("trigger_conversation_delivery_tasks_source_scheduled_action_id_idx")
        .on(table.sourceScheduledActionId)
        .where(sql`${table.sourceScheduledActionId} is not null`),
      index("trigger_conversation_delivery_tasks_status_idx").on(table.status),
      index("trigger_conversation_delivery_tasks_dequeue_idx").on(
        table.conversationId,
        table.status,
        table.sourceOrderKey,
        table.createdAt,
        table.id,
      ),
      check(
        "trigger_conversation_delivery_tasks_exactly_one_source_check",
        sql`(${table.sourceWebhookEventId} is not null and ${table.sourceScheduledActionId} is null) or (${table.sourceWebhookEventId} is null and ${table.sourceScheduledActionId} is not null)`,
      ),
    ],
  );
}

export const triggerConversationDeliveryTasks =
  defineTriggerConversationDeliveryTasks(controlPlaneSchema);

export type TriggerConversationDeliveryTask = typeof triggerConversationDeliveryTasks.$inferSelect;
export type InsertTriggerConversationDeliveryTask =
  typeof triggerConversationDeliveryTasks.$inferInsert;
