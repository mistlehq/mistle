import { bigint, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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
  ],
);

export type SandboxProfileVersion = typeof sandboxProfileVersions.$inferSelect;
export type InsertSandboxProfileVersion = typeof sandboxProfileVersions.$inferInsert;
