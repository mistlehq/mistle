import { primaryKey, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { oauthClients } from "./oauth-clients.js";

export function defineOAuthClientRedirectUris(schema: PgSchema) {
  return schema.table(
    "oauth_client_redirect_uris",
    {
      oauthClientId: text("oauth_client_id")
        .notNull()
        .references(() => oauthClients.id, { onDelete: "cascade" }),
      redirectUri: text("redirect_uri").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "oauth_client_redirect_uris_oauth_client_id_redirect_uri_pk",
        columns: [table.oauthClientId, table.redirectUri],
      }),
    ],
  );
}

export const oauthClientRedirectUris = defineOAuthClientRedirectUris(controlPlaneSchema);

export type OAuthClientRedirectUri = typeof oauthClientRedirectUris.$inferSelect;
export type InsertOAuthClientRedirectUri = typeof oauthClientRedirectUris.$inferInsert;
