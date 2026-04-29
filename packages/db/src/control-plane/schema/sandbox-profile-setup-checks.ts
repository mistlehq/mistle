import { sql } from "drizzle-orm";
import { bigint, foreignKey, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { sandboxProfileVersions } from "./sandbox-profile-versions.js";
import { users } from "./users.js";

export const SandboxProfileSetupCheckStatuses = {
  QUEUED: "queued",
  COMPILING_PROFILE: "compiling_profile",
  STARTING_SANDBOX: "starting_sandbox",
  WAITING_FOR_RUNTIME: "waiting_for_runtime",
  RUNNING_SCRIPT: "running_script",
  CLEANING_UP: "cleaning_up",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  CLEANUP_FAILED: "cleanup_failed",
} as const;

export type SandboxProfileSetupCheckStatus =
  (typeof SandboxProfileSetupCheckStatuses)[keyof typeof SandboxProfileSetupCheckStatuses];

export const SandboxProfileSetupCheckFailurePhases = {
  COMPILE: "compile",
  START: "start",
  RUNTIME_READY: "runtime_ready",
  SCRIPT: "script",
  CLEANUP: "cleanup",
} as const;

export type SandboxProfileSetupCheckFailurePhase =
  (typeof SandboxProfileSetupCheckFailurePhases)[keyof typeof SandboxProfileSetupCheckFailurePhases];

export const sandboxProfileSetupChecks = controlPlaneSchema.table(
  "sandbox_profile_setup_checks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("spc").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sandboxProfileId: text("sandbox_profile_id").notNull(),
    sandboxProfileVersion: bigint("sandbox_profile_version", { mode: "number" }).notNull(),
    requestedByUserId: text("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    setupScript: text("setup_script"),
    primaryRepositoryId: text("primary_repository_id"),
    idempotencyKey: text("idempotency_key"),
    status: text("status")
      .notNull()
      .$type<SandboxProfileSetupCheckStatus>()
      .default(SandboxProfileSetupCheckStatuses.QUEUED),
    failurePhase: text("failure_phase").$type<SandboxProfileSetupCheckFailurePhase>(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    sandboxInstanceId: text("sandbox_instance_id"),
    workflowRunId: text("workflow_run_id"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "sandbox_profile_setup_checks_profile_version_fkey",
      columns: [table.sandboxProfileId, table.sandboxProfileVersion],
      foreignColumns: [sandboxProfileVersions.sandboxProfileId, sandboxProfileVersions.version],
    }).onDelete("cascade"),
    uniqueIndex("sandbox_profile_setup_checks_idempotency_uidx")
      .on(
        table.organizationId,
        table.sandboxProfileId,
        table.sandboxProfileVersion,
        table.idempotencyKey,
      )
      .where(sql`${table.idempotencyKey} is not null`),
    index("sandbox_profile_setup_checks_profile_version_created_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
      table.createdAt,
    ),
    index("sandbox_profile_setup_checks_status_created_idx").on(table.status, table.createdAt),
  ],
);

export type SandboxProfileSetupCheck = typeof sandboxProfileSetupChecks.$inferSelect;
export type InsertSandboxProfileSetupCheck = typeof sandboxProfileSetupChecks.$inferInsert;
