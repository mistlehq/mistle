import { bigint, index, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const SandboxProfileStatuses = {
  ACTIVE: "active",
  INACTIVE: "inactive",
} as const;

export type SandboxProfileStatus =
  (typeof SandboxProfileStatuses)[keyof typeof SandboxProfileStatuses];

export function defineSandboxProfiles(schema: PgSchema) {
  return schema.table(
    "sandbox_profiles",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("sbp").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      displayName: text("display_name").notNull(),
      activeVersion: bigint("active_version", { mode: "number" }),
      status: text("status")
        .notNull()
        .$type<SandboxProfileStatus>()
        .default(SandboxProfileStatuses.ACTIVE),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [index("sandbox_profiles_organization_id_idx").on(table.organizationId)],
  );
}

export const sandboxProfiles = defineSandboxProfiles(controlPlaneSchema);

export type SandboxProfile = typeof sandboxProfiles.$inferSelect;
export type InsertSandboxProfile = typeof sandboxProfiles.$inferInsert;
