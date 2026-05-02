import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type PgSchema,
} from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const SandboxProfileVersionStates = {
  DRAFT: "draft",
  PUBLISHED: "published",
} as const;

export type SandboxProfileVersionState =
  (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];

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
    },
    (table) => [
      primaryKey({
        columns: [table.sandboxProfileId, table.version],
      }),
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
