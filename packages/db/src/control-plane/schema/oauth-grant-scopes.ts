import { primaryKey, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { oauthGrants } from "./oauth-grants.js";

export function defineOAuthGrantScopes(schema: PgSchema) {
  return schema.table(
    "oauth_grant_scopes",
    {
      oauthGrantId: text("oauth_grant_id")
        .notNull()
        .references(() => oauthGrants.id, { onDelete: "cascade" }),
      scope: text("scope").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "oauth_grant_scopes_oauth_grant_id_scope_pk",
        columns: [table.oauthGrantId, table.scope],
      }),
    ],
  );
}

export const oauthGrantScopes = defineOAuthGrantScopes(controlPlaneSchema);

export type OAuthGrantScope = typeof oauthGrantScopes.$inferSelect;
export type InsertOAuthGrantScope = typeof oauthGrantScopes.$inferInsert;
