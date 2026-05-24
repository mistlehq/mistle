import { index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { oauthGrants } from "./oauth-grants.js";

export function defineOAuthAccessTokens(schema: PgSchema) {
  return schema.table(
    "oauth_access_tokens",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("oat").toString()),
      oauthGrantId: text("oauth_grant_id")
        .notNull()
        .references(() => oauthGrants.id, { onDelete: "cascade" }),
      tokenPrefix: text("token_prefix").notNull(),
      tokenHash: text("token_hash").notNull(),
      tokenHashAlgorithm: text("token_hash_algorithm").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
      revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("oauth_access_tokens_token_prefix_uidx").on(table.tokenPrefix),
      index("oauth_access_tokens_oauth_grant_id_idx").on(table.oauthGrantId),
      index("oauth_access_tokens_expires_at_idx").on(table.expiresAt),
    ],
  );
}

export const oauthAccessTokens = defineOAuthAccessTokens(controlPlaneSchema);

export type OAuthAccessToken = typeof oauthAccessTokens.$inferSelect;
export type InsertOAuthAccessToken = typeof oauthAccessTokens.$inferInsert;
