import { bigint, foreignKey, index, text, timestamp } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfileVersions } from "./sandbox-profile-versions.js";
import { sandboxProfiles } from "./sandbox-profiles.js";
import { schedules } from "./schedules.js";

export const sandboxProfileSnapshotRefreshScheduleTargets = controlPlaneSchema.table(
  "sandbox_profile_snapshot_refresh_schedule_targets",
  {
    scheduleId: text("schedule_id")
      .primaryKey()
      .references(() => schedules.id, { onDelete: "cascade" }),
    sandboxProfileId: text("sandbox_profile_id")
      .notNull()
      .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
    sandboxProfileVersion: bigint("sandbox_profile_version", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "sp_snapshot_refresh_targets_profile_version_fkey",
      columns: [table.sandboxProfileId, table.sandboxProfileVersion],
      foreignColumns: [sandboxProfileVersions.sandboxProfileId, sandboxProfileVersions.version],
    }).onDelete("cascade"),
    index("sp_snapshot_refresh_targets_profile_version_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
    ),
  ],
);

export type SandboxProfileSnapshotRefreshScheduleTarget =
  typeof sandboxProfileSnapshotRefreshScheduleTargets.$inferSelect;
export type InsertSandboxProfileSnapshotRefreshScheduleTarget =
  typeof sandboxProfileSnapshotRefreshScheduleTargets.$inferInsert;
