import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  jsonb,
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

export const UserExternalPrincipalStatuses = {
  ACTIVE: "active",
  UNLINKED: "unlinked",
  REAUTHORIZATION_REQUIRED: "reauthorization_required",
} as const;

export type UserExternalPrincipalStatus =
  (typeof UserExternalPrincipalStatuses)[keyof typeof UserExternalPrincipalStatuses];

export function defineUserExternalPrincipals(schema: PgSchema) {
  return schema.table(
    "user_external_principals",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("uep").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      providerFamily: text("provider_family").notNull(),
      providerSubjectId: text("provider_subject_id"),
      organizationProviderConfigId: text("organization_provider_config_id")
        .notNull()
        .references(() => organizationIdentityLinkProviderConfigs.id, { onDelete: "restrict" }),
      integrationConnectionId: text("integration_connection_id")
        .notNull()
        .references(() => integrationConnections.id, { onDelete: "restrict" }),
      status: text("status")
        .notNull()
        .$type<UserExternalPrincipalStatus>()
        .default(UserExternalPrincipalStatuses.ACTIVE),
      profile: jsonb("profile").$type<Record<string, unknown>>(),
      linkedAt: timestamp("linked_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      unlinkedAt: timestamp("unlinked_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      foreignKey({
        name: "user_ext_principals_org_provider_conn_cfg_fkey",
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
      uniqueIndex("user_external_principals_active_user_uidx")
        .on(table.organizationId, table.providerFamily, table.userId)
        .where(sql`${table.status} = 'active'`),
      uniqueIndex("user_external_principals_active_subject_uidx")
        .on(table.organizationId, table.providerFamily, table.providerSubjectId)
        .where(sql`${table.status} = 'active' and ${table.providerSubjectId} is not null`),
      uniqueIndex("user_external_principals_org_provider_id_uidx").on(
        table.organizationId,
        table.providerFamily,
        table.id,
      ),
      index("user_external_principals_org_user_provider_idx").on(
        table.organizationId,
        table.userId,
        table.providerFamily,
      ),
      index("user_external_principals_provider_config_idx").on(table.organizationProviderConfigId),
      index("user_external_principals_connection_id_idx").on(table.integrationConnectionId),
    ],
  );
}

export const userExternalPrincipals = defineUserExternalPrincipals(controlPlaneSchema);

export type UserExternalPrincipal = typeof userExternalPrincipals.$inferSelect;
export type InsertUserExternalPrincipal = typeof userExternalPrincipals.$inferInsert;
