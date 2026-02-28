import { bigint, boolean, foreignKey, index, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfileVersionIntegrationBindings } from "./sandbox-profile-version-integration-bindings.js";
import { sandboxProfileVersions } from "./sandbox-profile-versions.js";

export const sandboxProfileVersionTriggerRules = controlPlaneSchema.table(
  "sandbox_profile_version_trigger_rules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("itr").toString()),
    sandboxProfileId: text("sandbox_profile_id").notNull(),
    sandboxProfileVersion: bigint("sandbox_profile_version", {
      mode: "number",
    }).notNull(),
    sourceBindingId: text("source_binding_id").notNull(),
    eventType: text("event_type").notNull(),
    filter: jsonb("filter").$type<Record<string, unknown>>().notNull(),
    action: jsonb("action").$type<Record<string, unknown>>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "spv_trigger_rules_sandbox_profile_version_fkey",
      columns: [table.sandboxProfileId, table.sandboxProfileVersion],
      foreignColumns: [sandboxProfileVersions.sandboxProfileId, sandboxProfileVersions.version],
    }).onDelete("cascade"),
    foreignKey({
      name: "spv_trigger_rules_source_binding_scope_fkey",
      columns: [table.sandboxProfileId, table.sandboxProfileVersion, table.sourceBindingId],
      foreignColumns: [
        sandboxProfileVersionIntegrationBindings.sandboxProfileId,
        sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
        sandboxProfileVersionIntegrationBindings.id,
      ],
    }).onDelete("cascade"),
    index("spv_trigger_rules_profile_id_version_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
    ),
    index("spv_trigger_rules_source_binding_id_idx").on(table.sourceBindingId),
    index("spv_trigger_rules_profile_id_version_event_type_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
      table.eventType,
    ),
    index("spv_trigger_rules_profile_id_version_enabled_idx").on(
      table.sandboxProfileId,
      table.sandboxProfileVersion,
      table.enabled,
    ),
  ],
);

export type SandboxProfileVersionTriggerRule =
  typeof sandboxProfileVersionTriggerRules.$inferSelect;
export type InsertSandboxProfileVersionTriggerRule =
  typeof sandboxProfileVersionTriggerRules.$inferInsert;
