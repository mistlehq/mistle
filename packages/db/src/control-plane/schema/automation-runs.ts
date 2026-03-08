import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { automationTargets } from "./automation-targets.js";
import { automations } from "./automations.js";
import { conversations } from "./conversations.js";
import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";

export const AutomationRunStatuses = {
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  IGNORED: "ignored",
  DUPLICATE: "duplicate",
} as const;

export type AutomationRunStatus =
  (typeof AutomationRunStatuses)[keyof typeof AutomationRunStatuses];

export const automationRuns = controlPlaneSchema.table(
  "automation_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("aru").toString()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    automationTargetId: text("automation_target_id").references(() => automationTargets.id, {
      onDelete: "set null",
    }),
    sourceWebhookEventId: text("source_webhook_event_id").references(
      () => integrationWebhookEvents.id,
      {
        onDelete: "set null",
      },
    ),
    conversationId: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    renderedInput: text("rendered_input"),
    renderedConversationKey: text("rendered_conversation_key"),
    renderedIdempotencyKey: text("rendered_idempotency_key"),
    status: text("status")
      .notNull()
      .$type<AutomationRunStatus>()
      .default(AutomationRunStatuses.QUEUED),
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
    uniqueIndex("automation_runs_automation_target_id_source_webhook_event_id_uidx").on(
      table.automationTargetId,
      table.sourceWebhookEventId,
    ),
    index("automation_runs_automation_id_idx").on(table.automationId),
    index("automation_runs_automation_target_id_idx").on(table.automationTargetId),
    index("automation_runs_source_webhook_event_id_idx").on(table.sourceWebhookEventId),
    index("automation_runs_conversation_id_idx").on(table.conversationId),
    index("automation_runs_status_idx").on(table.status),
    index("automation_runs_created_at_idx").on(table.createdAt),
  ],
);

export type AutomationRun = typeof automationRuns.$inferSelect;
export type InsertAutomationRun = typeof automationRuns.$inferInsert;
