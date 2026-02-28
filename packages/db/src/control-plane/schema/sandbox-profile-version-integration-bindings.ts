import { bigint, foreignKey, index, jsonb, text, timestamp, unique } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfileVersions } from "./sandbox-profile-versions.js";

export const IntegrationBindingKinds = {
  AGENT: "agent",
  GIT: "git",
  CONNECTOR: "connector",
} as const;

export type IntegrationBindingKind =
  (typeof IntegrationBindingKinds)[keyof typeof IntegrationBindingKinds];

export const sandboxProfileVersionIntegrationBindings = controlPlaneSchema.table(
  "sandbox_profile_version_integration_bindings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ibd").toString()),
    sandboxProfileId: text("sandbox_profile_id").notNull(),
    sandboxProfileVersion: bigint("sandbox_profile_version", {
      mode: "number",
    }).notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "restrict" }),
    kind: text("kind").$type<IntegrationBindingKind>().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "spv_integration_bindings_sandbox_profile_version_fkey",
      columns: [table.sandboxProfileId, table.sandboxProfileVersion],
      foreignColumns: [sandboxProfileVersions.sandboxProfileId, sandboxProfileVersions.version],
    }).onDelete("cascade"),
    index("spv_integration_bindings_profile_id_version_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
    ),
    index("spv_integration_bindings_connection_id_idx").on(table.connectionId),
    index("spv_integration_bindings_profile_id_version_kind_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
      table.kind,
    ),
    unique("spv_integration_bindings_profile_id_version_id_uidx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
      table.id,
    ),
  ],
);

export type SandboxProfileVersionIntegrationBinding =
  typeof sandboxProfileVersionIntegrationBindings.$inferSelect;
export type InsertSandboxProfileVersionIntegrationBinding =
  typeof sandboxProfileVersionIntegrationBindings.$inferInsert;
