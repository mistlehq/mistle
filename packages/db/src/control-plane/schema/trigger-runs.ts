import { sql } from "drizzle-orm";
import { index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";
import { scheduledActions } from "./scheduled-actions.js";
import { triggerConversations } from "./trigger-conversations.js";
import { triggerTargets } from "./trigger-targets.js";
import { triggers } from "./triggers.js";

export const TriggerRunStatuses = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  IGNORED: "ignored",
  DUPLICATE: "duplicate",
} as const;

export type TriggerRunStatus = (typeof TriggerRunStatuses)[keyof typeof TriggerRunStatuses];

export function defineTriggerRuns(schema: PgSchema) {
  return schema.table(
    "trigger_runs",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("trn").toString()),
      triggerId: text("trigger_id")
        .notNull()
        .references(() => triggers.id, { onDelete: "cascade" }),
      triggerTargetId: text("trigger_target_id").references(() => triggerTargets.id, {
        onDelete: "set null",
      }),
      sourceWebhookEventId: text("source_webhook_event_id").references(
        () => integrationWebhookEvents.id,
        {
          onDelete: "set null",
        },
      ),
      sourceScheduledActionId: text("source_scheduled_action_id").references(
        () => scheduledActions.id,
        {
          onDelete: "set null",
        },
      ),
      conversationId: text("conversation_id").references(() => triggerConversations.id, {
        onDelete: "set null",
      }),
      renderedInput: text("rendered_input"),
      renderedConversationKey: text("rendered_conversation_key"),
      renderedIdempotencyKey: text("rendered_idempotency_key"),
      instructions: text("instructions"),
      status: text("status").notNull().$type<TriggerRunStatus>().default(TriggerRunStatuses.QUEUED),
      failureCode: text("failure_code"),
      failureMessage: text("failure_message"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
      finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("trigger_runs_trigger_target_id_source_webhook_event_id_uidx").on(
        table.triggerTargetId,
        table.sourceWebhookEventId,
      ),
      index("trigger_runs_trigger_id_idx").on(table.triggerId),
      index("trigger_runs_source_webhook_event_id_idx").on(table.sourceWebhookEventId),
      uniqueIndex("trigger_runs_source_scheduled_action_id_uidx")
        .on(table.sourceScheduledActionId)
        .where(sql`${table.sourceScheduledActionId} is not null`),
      index("trigger_runs_conversation_id_idx").on(table.conversationId),
      index("trigger_runs_status_idx").on(table.status),
      index("trigger_runs_created_at_idx").on(table.createdAt),
    ],
  );
}

export const triggerRuns = defineTriggerRuns(controlPlaneSchema);

export type TriggerRun = typeof triggerRuns.$inferSelect;
export type InsertTriggerRun = typeof triggerRuns.$inferInsert;
