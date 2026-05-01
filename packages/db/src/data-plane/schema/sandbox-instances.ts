import { bigint, index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";

export const SandboxInstanceProviders = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;

export type SandboxInstanceProvider =
  (typeof SandboxInstanceProviders)[keyof typeof SandboxInstanceProviders];

export const SandboxInstanceStatuses = {
  PENDING: "pending",
  STARTING: "starting",
  RUNNING: "running",
  STOPPED: "stopped",
  FAILED: "failed",
} as const;

export type SandboxInstanceStatus =
  (typeof SandboxInstanceStatuses)[keyof typeof SandboxInstanceStatuses];

export const SandboxInstanceStarterKinds = {
  USER: "user",
  SYSTEM: "system",
} as const;

export type SandboxInstanceStarterKind =
  (typeof SandboxInstanceStarterKinds)[keyof typeof SandboxInstanceStarterKinds];

export const SandboxInstanceSources = {
  DASHBOARD: "dashboard",
  WEBHOOK: "webhook",
  SYSTEM: "system",
} as const;

export type SandboxInstanceSource =
  (typeof SandboxInstanceSources)[keyof typeof SandboxInstanceSources];

export const SandboxInstancePurposes = {
  SESSION: "session",
  SNAPSHOT: "snapshot",
  SETUP_CHECK: "setup_check",
} as const;

export type SandboxInstancePurpose =
  (typeof SandboxInstancePurposes)[keyof typeof SandboxInstancePurposes];

export const SandboxStopReasons = {
  IDLE: "idle",
  DISCONNECTED: "disconnected",
  USER: "user",
  SYSTEM: "system",
  FAILED: "failed",
} as const;

export type SandboxStopReason = (typeof SandboxStopReasons)[keyof typeof SandboxStopReasons];

export const SandboxInstancePersistenceModes = {
  EPHEMERAL: "ephemeral",
  PERSISTENT: "persistent",
} as const;

export type SandboxInstancePersistenceMode =
  (typeof SandboxInstancePersistenceModes)[keyof typeof SandboxInstancePersistenceModes];

export function defineSandboxInstances(schema: PgSchema) {
  return schema.table(
    "sandbox_instances",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("sbi").toString()),
      organizationId: text("organization_id").notNull(),
      sandboxProfileId: text("sandbox_profile_id").notNull(),
      sandboxProfileVersion: bigint("sandbox_profile_version", { mode: "number" }).notNull(),
      runtimeProvider: text("runtime_provider").notNull().$type<SandboxInstanceProvider>(),
      providerSandboxId: text("provider_sandbox_id"),
      computeGeneration: bigint("compute_generation", { mode: "number" }).notNull().default(1),
      status: text("status")
        .notNull()
        .$type<SandboxInstanceStatus>()
        .default(SandboxInstanceStatuses.PENDING),
      startedByKind: text("started_by_kind").notNull().$type<SandboxInstanceStarterKind>(),
      startedById: text("started_by_id").notNull(),
      source: text("source").notNull().$type<SandboxInstanceSource>(),
      purpose: text("purpose")
        .notNull()
        .$type<SandboxInstancePurpose>()
        .default(SandboxInstancePurposes.SESSION),
      title: text("title"),
      persistenceMode: text("persistence_mode")
        .notNull()
        .$type<SandboxInstancePersistenceMode>()
        .default(SandboxInstancePersistenceModes.EPHEMERAL),
      startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
      stoppedAt: timestamp("stopped_at", { withTimezone: true, mode: "string" }),
      stopReason: text("stop_reason").$type<SandboxStopReason>(),
      failedAt: timestamp("failed_at", { withTimezone: true, mode: "string" }),
      failureCode: text("failure_code"),
      failureMessage: text("failure_message"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("sandbox_instances_organization_id_idx").on(table.organizationId),
      index("sandbox_instances_org_profile_version_idx").on(
        table.organizationId,
        table.sandboxProfileId,
        table.sandboxProfileVersion,
      ),
      index("sandbox_instances_org_status_updated_idx").on(
        table.organizationId,
        table.status,
        table.updatedAt,
      ),
      uniqueIndex("sandbox_instances_provider_sandbox_uidx").on(
        table.runtimeProvider,
        table.providerSandboxId,
      ),
    ],
  );
}

export const sandboxInstances = defineSandboxInstances(dataPlaneSchema);

export type SandboxInstance = typeof sandboxInstances.$inferSelect;
export type InsertSandboxInstance = typeof sandboxInstances.$inferInsert;
