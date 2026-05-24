import { primaryKey, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { oauthClients } from "./oauth-clients.js";

export function defineOAuthClientScopes(schema: PgSchema) {
  return schema.table(
    "oauth_client_scopes",
    {
      oauthClientId: text("oauth_client_id")
        .notNull()
        .references(() => oauthClients.id, { onDelete: "cascade" }),
      scope: text("scope").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "oauth_client_scopes_oauth_client_id_scope_pk",
        columns: [table.oauthClientId, table.scope],
      }),
    ],
  );
}

export const oauthClientScopes = defineOAuthClientScopes(controlPlaneSchema);

export type OAuthClientScope = typeof oauthClientScopes.$inferSelect;
export type InsertOAuthClientScope = typeof oauthClientScopes.$inferInsert;
