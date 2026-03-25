import { bigint, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";

export const SandboxInstanceProviders = {
  MODAL: "modal",
  DOCKER: "docker",
} as const;

export type SandboxInstanceProvider =
  (typeof SandboxInstanceProviders)[keyof typeof SandboxInstanceProviders];

export const SandboxInstanceVolumeProviders = SandboxInstanceProviders;

export type SandboxInstanceVolumeProvider = SandboxInstanceProvider;

export const SandboxInstanceVolumeModes = {
  NATIVE: "native",
  STAGED: "staged",
} as const;

export type SandboxInstanceVolumeMode =
  (typeof SandboxInstanceVolumeModes)[keyof typeof SandboxInstanceVolumeModes];

export const SandboxInstanceStatuses = {
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
} as const;

export type SandboxInstanceSource =
  (typeof SandboxInstanceSources)[keyof typeof SandboxInstanceSources];

export const SandboxStopReasons = {
  IDLE: "idle",
  DISCONNECTED: "disconnected",
  USER: "user",
  SYSTEM: "system",
  FAILED: "failed",
} as const;

export type SandboxStopReason = (typeof SandboxStopReasons)[keyof typeof SandboxStopReasons];

export const sandboxInstances = dataPlaneSchema.table(
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
    instanceVolumeProvider: text("instance_volume_provider").$type<SandboxInstanceVolumeProvider>(),
    instanceVolumeId: text("instance_volume_id"),
    instanceVolumeMode: text("instance_volume_mode").$type<SandboxInstanceVolumeMode>(),
    status: text("status")
      .notNull()
      .$type<SandboxInstanceStatus>()
      .default(SandboxInstanceStatuses.STARTING),
    startedByKind: text("started_by_kind").notNull().$type<SandboxInstanceStarterKind>(),
    startedById: text("started_by_id").notNull(),
    source: text("source").notNull().$type<SandboxInstanceSource>(),
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
    uniqueIndex("sandbox_instances_instance_volume_uidx").on(
      table.instanceVolumeProvider,
      table.instanceVolumeId,
    ),
  ],
);

export type SandboxInstance = typeof sandboxInstances.$inferSelect;
export type InsertSandboxInstance = typeof sandboxInstances.$inferInsert;
