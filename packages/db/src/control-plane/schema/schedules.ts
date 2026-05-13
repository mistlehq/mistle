import { sql } from "drizzle-orm";
import { boolean, check, index, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const ScheduleTargetTypes = {
  AUTOMATION_RUN: "automation_run",
  SNAPSHOT_REFRESH: "sandbox_profile_snapshot_refresh",
} as const;

export type ScheduleTargetType = (typeof ScheduleTargetTypes)[keyof typeof ScheduleTargetTypes];

export function defineSchedules(schema: PgSchema) {
  return schema.table(
    "schedules",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("sch").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      targetType: text("target_type").notNull().$type<ScheduleTargetType>(),
      name: text("name").notNull(),
      cronExpression: text("cron_expression").notNull(),
      timezone: text("timezone").notNull(),
      enabled: boolean("enabled").notNull().default(true),
      nextScheduledAt: timestamp("next_scheduled_at", { withTimezone: true, mode: "string" }),
      lastScheduledAt: timestamp("last_scheduled_at", { withTimezone: true, mode: "string" }),
      startAt: timestamp("start_at", { withTimezone: true, mode: "string" }),
      endAt: timestamp("end_at", { withTimezone: true, mode: "string" }),
      deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("schedules_organization_id_target_type_idx").on(table.organizationId, table.targetType),
      index("schedules_due_idx")
        .on(table.nextScheduledAt, table.id)
        .where(
          sql`${table.enabled} = true and ${table.deletedAt} is null and ${table.nextScheduledAt} is not null`,
        ),
      check(
        "schedules_end_at_after_start_at_check",
        sql`${table.endAt} is null or ${table.startAt} is null or ${table.endAt} >= ${table.startAt}`,
      ),
    ],
  );
}

export const schedules = defineSchedules(controlPlaneSchema);

export type Schedule = typeof schedules.$inferSelect;
export type InsertSchedule = typeof schedules.$inferInsert;
