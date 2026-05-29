import { index, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { oauthClients } from "./oauth-clients.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export function defineOAuthGrants(schema: PgSchema) {
  return schema.table(
    "oauth_grants",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("oag").toString()),
      oauthClientId: text("oauth_client_id")
        .notNull()
        .references(() => oauthClients.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      // OAuth RFC 8707 protected resource audience, not a Mistle domain resource.
      resource: text("resource"),
      revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("oauth_grants_user_organization_idx").on(table.userId, table.organizationId),
      index("oauth_grants_resource_idx").on(table.resource),
    ],
  );
}

export const oauthGrants = defineOAuthGrants(controlPlaneSchema);

export type OAuthGrant = typeof oauthGrants.$inferSelect;
export type InsertOAuthGrant = typeof oauthGrants.$inferInsert;
