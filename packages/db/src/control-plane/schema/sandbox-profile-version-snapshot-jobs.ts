import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfileVersions } from "./sandbox-profile-versions.js";

export const SandboxProfileVersionSnapshotJobTriggers = {
  PUBLISH: "publish",
  MANUAL_REFRESH: "manual_refresh",
  SCHEDULED_REFRESH: "scheduled_refresh",
} as const;

export type SandboxProfileVersionSnapshotJobTrigger =
  (typeof SandboxProfileVersionSnapshotJobTriggers)[keyof typeof SandboxProfileVersionSnapshotJobTriggers];

export const SandboxProfileVersionSnapshotJobStates = {
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export type SandboxProfileVersionSnapshotJobState =
  (typeof SandboxProfileVersionSnapshotJobStates)[keyof typeof SandboxProfileVersionSnapshotJobStates];

export const sandboxProfileVersionSnapshotJobs = controlPlaneSchema.table(
  "sandbox_profile_version_snapshot_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ssj").toString()),
    sandboxProfileId: text("sandbox_profile_id").notNull(),
    sandboxProfileVersion: bigint("sandbox_profile_version", {
      mode: "number",
    }).notNull(),
    workflowRunId: text("workflow_run_id"),
    trigger: text("trigger").notNull().$type<SandboxProfileVersionSnapshotJobTrigger>(),
    state: text("state").notNull().$type<SandboxProfileVersionSnapshotJobState>(),
    candidateImageProvider: text("candidate_image_provider"),
    candidateImageId: text("candidate_image_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "spv_snapshot_jobs_profile_version_fkey",
      columns: [table.sandboxProfileId, table.sandboxProfileVersion],
      foreignColumns: [sandboxProfileVersions.sandboxProfileId, sandboxProfileVersions.version],
    }).onDelete("cascade"),
    check(
      "spv_snapshot_jobs_candidate_image_handle_check",
      sql`(${table.candidateImageProvider} is null and ${table.candidateImageId} is null) or (${table.candidateImageProvider} is not null and ${table.candidateImageId} is not null)`,
    ),
    uniqueIndex("spv_snapshot_jobs_active_job_per_version_uidx")
      .on(table.sandboxProfileId, table.sandboxProfileVersion)
      .where(sql`${table.state} in ('queued', 'running')`),
    index("spv_snapshot_jobs_profile_version_created_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
      table.createdAt,
    ),
    index("spv_snapshot_jobs_state_created_idx").on(table.state, table.createdAt),
  ],
);

export type SandboxProfileVersionSnapshotJob =
  typeof sandboxProfileVersionSnapshotJobs.$inferSelect;
export type InsertSandboxProfileVersionSnapshotJob =
  typeof sandboxProfileVersionSnapshotJobs.$inferInsert;
