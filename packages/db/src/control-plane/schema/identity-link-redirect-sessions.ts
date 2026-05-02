import {
  foreignKey,
  index,
  text,
  timestamp,
  uniqueIndex,
  type PgSchema,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizationIdentityLinkProviderConfigs } from "./organization-identity-link-provider-configs.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export function defineIdentityLinkRedirectSessions(schema: PgSchema) {
  return schema.table(
    "identity_link_redirect_sessions",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("ilr").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      providerFamily: text("provider_family").notNull(),
      organizationProviderConfigId: text("organization_provider_config_id")
        .notNull()
        .references(() => organizationIdentityLinkProviderConfigs.id, { onDelete: "restrict" }),
      integrationConnectionId: text("integration_connection_id")
        .notNull()
        .references(() => integrationConnections.id, { onDelete: "restrict" }),
      state: text("state").notNull(),
      pkceVerifierEncrypted: text("pkce_verifier_encrypted"),
      providerStateEncrypted: text("provider_state_encrypted"),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
      usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      foreignKey({
        name: "identity_link_redirect_sessions_org_provider_conn_cfg_fkey",
        columns: [
          table.organizationId,
          table.providerFamily,
          table.integrationConnectionId,
          table.organizationProviderConfigId,
        ],
        foreignColumns: [
          organizationIdentityLinkProviderConfigs.organizationId,
          organizationIdentityLinkProviderConfigs.providerFamily,
          organizationIdentityLinkProviderConfigs.integrationConnectionId,
          organizationIdentityLinkProviderConfigs.id,
        ],
      }).onDelete("restrict"),
      uniqueIndex("identity_link_redirect_sessions_state_uidx").on(table.state),
      index("identity_link_redirect_sessions_org_user_idx").on(table.organizationId, table.userId),
      index("identity_link_redirect_sessions_org_provider_user_idx").on(
        table.organizationId,
        table.providerFamily,
        table.userId,
      ),
      index("identity_link_redirect_sessions_expires_at_idx").on(table.expiresAt),
    ],
  );
}

export const identityLinkRedirectSessions = defineIdentityLinkRedirectSessions(controlPlaneSchema);

export type IdentityLinkRedirectSession = typeof identityLinkRedirectSessions.$inferSelect;
export type InsertIdentityLinkRedirectSession = typeof identityLinkRedirectSessions.$inferInsert;
