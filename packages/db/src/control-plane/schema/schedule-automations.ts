import { index, text, timestamp } from "drizzle-orm/pg-core";

import { automations } from "./automations.js";
import { controlPlaneSchema } from "./namespace.js";

export const scheduleAutomations = controlPlaneSchema.table(
  "schedule_automations",
  {
    automationId: text("automation_id")
      .primaryKey()
      .references(() => automations.id, { onDelete: "cascade" }),
    cronExpression: text("cron_expression").notNull(),
    timezone: text("timezone").notNull(),
    inputTemplate: text("input_template").notNull(),
    conversationKeyTemplate: text("conversation_key_template").notNull(),
    idempotencyKeyTemplate: text("idempotency_key_template"),
    startAt: timestamp("start_at", { withTimezone: true, mode: "string" }),
    endAt: timestamp("end_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("schedule_automations_automation_id_idx").on(table.automationId)],
);

export type ScheduleAutomation = typeof scheduleAutomations.$inferSelect;
export type InsertScheduleAutomation = typeof scheduleAutomations.$inferInsert;
