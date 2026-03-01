import { bigint, primaryKey, text } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const sandboxProfileVersions = controlPlaneSchema.table(
  "sandbox_profile_versions",
  {
    sandboxProfileId: text("sandbox_profile_id")
      .notNull()
      .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sandboxProfileId, table.version],
    }),
  ],
);

export type SandboxProfileVersion = typeof sandboxProfileVersions.$inferSelect;
export type InsertSandboxProfileVersion = typeof sandboxProfileVersions.$inferInsert;
