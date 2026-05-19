import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type PgSchema,
} from "drizzle-orm/pg-core";

import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const SandboxProfileVersionStates = {
  DRAFT: "draft",
  PUBLISHED: "published",
} as const;

export type SandboxProfileVersionState =
  (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];

export const SandboxProfileVersionDefaultPersistenceModes = {
  EPHEMERAL: "ephemeral",
  PERSISTENT: "persistent",
} as const;

export type SandboxProfileVersionDefaultPersistenceMode =
  (typeof SandboxProfileVersionDefaultPersistenceModes)[keyof typeof SandboxProfileVersionDefaultPersistenceModes];

export const SandboxProfileVersionAgentRuntimeIds = {
  CODEX: "codex",
  OPENCODE: "opencode",
  PI: "pi",
} as const;

export type SandboxProfileVersionAgentRuntimeId =
  (typeof SandboxProfileVersionAgentRuntimeIds)[keyof typeof SandboxProfileVersionAgentRuntimeIds];

export function defineSandboxProfileVersions(schema: PgSchema) {
  return schema.table(
    "sandbox_profile_versions",
    {
      sandboxProfileId: text("sandbox_profile_id")
        .notNull()
        .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
      version: bigint("version", { mode: "number" }).notNull(),
      state: text("state")
        .notNull()
        .$type<SandboxProfileVersionState>()
        .default(SandboxProfileVersionStates.PUBLISHED),
      publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }),
      snapshotImageProvider: text("snapshot_image_provider"),
      snapshotImageId: text("snapshot_image_id"),
      setupScript: text("setup_script"),
      maintenanceScript: text("maintenance_script"),
      defaultPersistenceMode: text("default_persistence_mode")
        .notNull()
        .$type<SandboxProfileVersionDefaultPersistenceMode>()
        .default(SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL),
      sandboxProvider: text("sandbox_provider"),
      sandboxConnectionId: text("sandbox_connection_id"),
      sandboxVcpuCount: bigint("sandbox_vcpu_count", { mode: "number" }),
      sandboxMemoryMb: bigint("sandbox_memory_mb", { mode: "number" }),
      sandboxStorageMb: bigint("sandbox_storage_mb", { mode: "number" }),
      agentRuntimeId: text("agent_runtime_id")
        .notNull()
        .$type<SandboxProfileVersionAgentRuntimeId>()
        .default(SandboxProfileVersionAgentRuntimeIds.CODEX),
    },
    (table) => [
      primaryKey({
        columns: [table.sandboxProfileId, table.version],
      }),
      foreignKey({
        name: "sandbox_profile_versions_sandbox_connection_id_fkey",
        columns: [table.sandboxConnectionId],
        foreignColumns: [integrationConnections.id],
      }).onDelete("restrict"),
      check(
        "sandbox_profile_versions_snapshot_image_handle_check",
        sql`(${table.snapshotImageProvider} is null and ${table.snapshotImageId} is null) or (${table.snapshotImageProvider} is not null and ${table.snapshotImageId} is not null)`,
      ),
      uniqueIndex("sandbox_profile_versions_one_draft_per_profile_uidx")
        .on(table.sandboxProfileId)
        .where(sql`${table.state} = 'draft'`),
    ],
  );
}

export const sandboxProfileVersions = defineSandboxProfileVersions(controlPlaneSchema);

export type SandboxProfileVersion = typeof sandboxProfileVersions.$inferSelect;
export type InsertSandboxProfileVersion = typeof sandboxProfileVersions.$inferInsert;
