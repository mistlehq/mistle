import { sql } from "drizzle-orm";
import { bigint, check, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const SandboxProfileVersionStates = {
  DRAFT: "draft",
  PUBLISHED: "published",
} as const;

export type SandboxProfileVersionState =
  (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];

export const sandboxProfileVersions = controlPlaneSchema.table(
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
    setupScript: text("setup_script"),
  },
  (table) => [
    primaryKey({
      columns: [table.sandboxProfileId, table.version],
    }),
    uniqueIndex("sandbox_profile_versions_one_draft_per_profile_uidx")
      .on(table.sandboxProfileId)
      .where(sql`${table.state} = 'draft'`),
    check("sandbox_profile_versions_state_check", sql`${table.state} in ('draft', 'published')`),
  ],
);

export type SandboxProfileVersion = typeof sandboxProfileVersions.$inferSelect;
export type InsertSandboxProfileVersion = typeof sandboxProfileVersions.$inferInsert;
