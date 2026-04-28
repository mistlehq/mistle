import { text, timestamp } from "drizzle-orm/pg-core";

import { automations } from "./automations.js";
import { controlPlaneSchema } from "./namespace.js";
import { schedules } from "./schedules.js";

export const scheduleAutomations = controlPlaneSchema.table("schedule_automations", {
  scheduleId: text("schedule_id")
    .primaryKey()
    .references(() => schedules.id, { onDelete: "cascade" }),
  automationId: text("automation_id")
    .notNull()
    .references(() => automations.id, { onDelete: "cascade" }),
  inputTemplate: text("input_template").notNull(),
  conversationKeyTemplate: text("conversation_key_template").notNull(),
  idempotencyKeyTemplate: text("idempotency_key_template"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export type ScheduleAutomation = typeof scheduleAutomations.$inferSelect;
export type InsertScheduleAutomation = typeof scheduleAutomations.$inferInsert;
