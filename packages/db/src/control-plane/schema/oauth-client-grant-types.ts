import { primaryKey, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { oauthClients } from "./oauth-clients.js";

export const OAuthGrantTypes = {
  AUTHORIZATION_CODE: "authorization_code",
  REFRESH_TOKEN: "refresh_token",
  DEVICE_CODE: "urn:ietf:params:oauth:grant-type:device_code",
} as const;

export type OAuthGrantType = (typeof OAuthGrantTypes)[keyof typeof OAuthGrantTypes];

export function defineOAuthClientGrantTypes(schema: PgSchema) {
  return schema.table(
    "oauth_client_grant_types",
    {
      oauthClientId: text("oauth_client_id")
        .notNull()
        .references(() => oauthClients.id, { onDelete: "cascade" }),
      grantType: text("grant_type").$type<OAuthGrantType>().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "oauth_client_grant_types_oauth_client_id_grant_type_pk",
        columns: [table.oauthClientId, table.grantType],
      }),
    ],
  );
}

export const oauthClientGrantTypes = defineOAuthClientGrantTypes(controlPlaneSchema);

export type OAuthClientGrantType = typeof oauthClientGrantTypes.$inferSelect;
export type InsertOAuthClientGrantType = typeof oauthClientGrantTypes.$inferInsert;
