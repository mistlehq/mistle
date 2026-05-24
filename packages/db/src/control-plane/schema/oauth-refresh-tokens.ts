import { index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { oauthGrants } from "./oauth-grants.js";

export function defineOAuthRefreshTokens(schema: PgSchema) {
  return schema.table(
    "oauth_refresh_tokens",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("ort").toString()),
      oauthGrantId: text("oauth_grant_id")
        .notNull()
        .references(() => oauthGrants.id, { onDelete: "cascade" }),
      tokenPrefix: text("token_prefix").notNull(),
      tokenHash: text("token_hash").notNull(),
      tokenHashAlgorithm: text("token_hash_algorithm").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
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
      uniqueIndex("oauth_refresh_tokens_token_prefix_uidx").on(table.tokenPrefix),
      index("oauth_refresh_tokens_oauth_grant_id_idx").on(table.oauthGrantId),
    ],
  );
}

export const oauthRefreshTokens = defineOAuthRefreshTokens(controlPlaneSchema);

export type OAuthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
export type InsertOAuthRefreshToken = typeof oauthRefreshTokens.$inferInsert;
