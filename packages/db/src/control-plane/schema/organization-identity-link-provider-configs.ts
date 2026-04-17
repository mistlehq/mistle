import { foreignKey, index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { integrationTargets } from "./integration-targets.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const OrganizationIdentityLinkProviderConfigStatus = {
  ACTIVE: "active",
  DISABLED: "disabled",
} as const;

export type OrganizationIdentityLinkProviderConfigStatus =
  (typeof OrganizationIdentityLinkProviderConfigStatus)[keyof typeof OrganizationIdentityLinkProviderConfigStatus];

export const organizationIdentityLinkProviderConfigs = controlPlaneSchema.table(
  "organization_identity_link_provider_configs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ilp").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerFamily: text("provider_family").notNull(),
    status: text("status")
      .notNull()
      .$type<OrganizationIdentityLinkProviderConfigStatus>()
      .default(OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
    integrationTargetKey: text("integration_target_key")
      .notNull()
      .references(() => integrationTargets.targetKey, { onDelete: "restrict" }),
    integrationConnectionId: text("integration_connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "restrict" }),
    policy: jsonb("policy").$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    updatedByUserId: text("updated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "org_id_link_provider_cfgs_org_target_connection_fkey",
      columns: [table.organizationId, table.integrationTargetKey, table.integrationConnectionId],
      foreignColumns: [
        integrationConnections.organizationId,
        integrationConnections.targetKey,
        integrationConnections.id,
      ],
    }).onDelete("restrict"),
    uniqueIndex("org_identity_link_provider_cfgs_org_provider_uidx").on(
      table.organizationId,
      table.providerFamily,
    ),
    uniqueIndex("org_id_link_provider_cfgs_org_provider_conn_id_uidx").on(
      table.organizationId,
      table.providerFamily,
      table.integrationConnectionId,
      table.id,
    ),
    index("org_identity_link_provider_cfgs_org_status_idx").on(table.organizationId, table.status),
    index("org_identity_link_provider_cfgs_target_key_idx").on(table.integrationTargetKey),
    index("org_identity_link_provider_cfgs_connection_id_idx").on(table.integrationConnectionId),
  ],
);

export type OrganizationIdentityLinkProviderConfig =
  typeof organizationIdentityLinkProviderConfigs.$inferSelect;
export type InsertOrganizationIdentityLinkProviderConfig =
  typeof organizationIdentityLinkProviderConfigs.$inferInsert;
