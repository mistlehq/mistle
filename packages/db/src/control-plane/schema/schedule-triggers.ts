import { text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { schedules } from "./schedules.js";
import { triggers } from "./triggers.js";

export function defineScheduleTriggers(schema: PgSchema) {
  return schema.table(
    "schedule_triggers",
    {
      scheduleId: text("schedule_id")
        .primaryKey()
        .references(() => schedules.id, { onDelete: "cascade" }),
      triggerId: text("trigger_id")
        .notNull()
        .references(() => triggers.id, { onDelete: "cascade" }),
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
    (table) => [uniqueIndex("schedule_triggers_trigger_id_uidx").on(table.triggerId)],
  );
}

export const scheduleTriggers = defineScheduleTriggers(controlPlaneSchema);

export type ScheduleTrigger = typeof scheduleTriggers.$inferSelect;
export type InsertScheduleTrigger = typeof scheduleTriggers.$inferInsert;
