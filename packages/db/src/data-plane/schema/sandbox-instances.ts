import { bigint, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";

export const SandboxInstanceProviders = {
  MODAL: "modal",
  DOCKER: "docker",
} as const;

export type SandboxInstanceProvider =
  (typeof SandboxInstanceProviders)[keyof typeof SandboxInstanceProviders];

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
} as const;

export type SandboxInstanceStarterKind =
  (typeof SandboxInstanceStarterKinds)[keyof typeof SandboxInstanceStarterKinds];

export const SandboxInstanceSources = {
  DASHBOARD: "dashboard",
} as const;

export type SandboxInstanceSource =
  (typeof SandboxInstanceSources)[keyof typeof SandboxInstanceSources];

export const sandboxInstances = dataPlaneSchema.table(
  "sandbox_instances",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sbi").toString()),
    organizationId: text("organization_id").notNull(),
    sandboxProfileId: text("sandbox_profile_id").notNull(),
    sandboxProfileVersion: bigint("sandbox_profile_version", { mode: "number" }).notNull(),
    provider: text("provider").notNull().$type<SandboxInstanceProvider>(),
    providerSandboxId: text("provider_sandbox_id"),
    status: text("status")
      .notNull()
      .$type<SandboxInstanceStatus>()
      .default(SandboxInstanceStatuses.STARTING),
    startedByKind: text("started_by_kind").notNull().$type<SandboxInstanceStarterKind>(),
    startedById: text("started_by_id").notNull(),
    source: text("source").notNull().$type<SandboxInstanceSource>(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true, mode: "string" }),
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
      table.provider,
      table.providerSandboxId,
    ),
  ],
);

export type SandboxInstance = typeof sandboxInstances.$inferSelect;
export type InsertSandboxInstance = typeof sandboxInstances.$inferInsert;
