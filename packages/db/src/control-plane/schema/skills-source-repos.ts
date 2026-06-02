import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export type SkillsSourceRepoSkill = {
  name: string;
  description: string;
  relativePath: string;
};

export function defineSkillsSourceRepos(schema: PgSchema) {
  return schema.table(
    "skills_source_repos",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("skr").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      originUrl: text("origin_url").notNull(),
      commitSha: text("commit_sha"),
      skills: jsonb("skills")
        .$type<SkillsSourceRepoSkill[]>()
        .notNull()
        .default(sql`'[]'::jsonb`),
      lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("skills_source_repos_organization_id_origin_url_uidx").on(
        table.organizationId,
        table.originUrl,
      ),
      index("skills_source_repos_organization_id_idx").on(table.organizationId),
    ],
  );
}

export const skillsSourceRepos = defineSkillsSourceRepos(controlPlaneSchema);

export type SkillsSourceRepo = typeof skillsSourceRepos.$inferSelect;
export type InsertSkillsSourceRepo = typeof skillsSourceRepos.$inferInsert;
