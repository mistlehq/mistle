import { jsonb, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { schedules, type ScheduleTargetType } from "./schedules.js";

export const ScheduledActionStatuses = {
  PENDING: "pending",
  DISPATCHING: "dispatching",
  DISPATCHED: "dispatched",
  FAILED: "failed",
  SKIPPED_LATE: "skipped_late",
} as const;

export type ScheduledActionStatus =
  (typeof ScheduledActionStatuses)[keyof typeof ScheduledActionStatuses];

export const scheduledActions = controlPlaneSchema.table(
  "scheduled_actions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sca").toString()),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => schedules.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull().$type<ScheduleTargetType>(),
    targetPayload: jsonb("target_payload").$type<Record<string, unknown>>().notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "string" }).notNull(),
    localScheduledDate: text("local_scheduled_date").notNull(),
    localScheduledTime: text("local_scheduled_time").notNull(),
    status: text("status")
      .notNull()
      .$type<ScheduledActionStatus>()
      .default(ScheduledActionStatuses.PENDING),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    dispatchingAt: timestamp("dispatching_at", { withTimezone: true, mode: "string" }),
    dispatchClaimKey: text("dispatch_claim_key"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "string" }),
    failedAt: timestamp("failed_at", { withTimezone: true, mode: "string" }),
    skippedAt: timestamp("skipped_at", { withTimezone: true, mode: "string" }),
    skippedFromScheduledAt: timestamp("skipped_from_scheduled_at", {
      withTimezone: true,
      mode: "string",
    }),
    skippedUntilScheduledAt: timestamp("skipped_until_scheduled_at", {
      withTimezone: true,
      mode: "string",
    }),
    targetWorkflowId: text("target_workflow_id"),
    targetWorkflowStartedAt: timestamp("target_workflow_started_at", {
      withTimezone: true,
      mode: "string",
    }),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
  },
  (table) => [
    uniqueIndex("scheduled_actions_schedule_id_scheduled_at_uidx").on(
      table.scheduleId,
      table.scheduledAt,
    ),
    uniqueIndex("scheduled_actions_schedule_id_local_scheduled_slot_uidx").on(
      table.scheduleId,
      table.localScheduledDate,
      table.localScheduledTime,
    ),
    index("scheduled_actions_schedule_id_idx").on(table.scheduleId),
    index("scheduled_actions_organization_id_idx").on(table.organizationId),
    index("scheduled_actions_status_idx").on(table.status),
    index("scheduled_actions_scheduled_at_idx").on(table.scheduledAt),
  ],
);

export type ScheduledAction = typeof scheduledActions.$inferSelect;
export type InsertScheduledAction = typeof scheduledActions.$inferInsert;
