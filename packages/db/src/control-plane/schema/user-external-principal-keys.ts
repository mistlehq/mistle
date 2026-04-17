import { sql } from "drizzle-orm";
import { foreignKey, index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { userExternalPrincipals } from "./user-external-principals.js";

export const UserExternalPrincipalKeyStatuses = {
  ACTIVE: "active",
  RETIRED: "retired",
} as const;

export type UserExternalPrincipalKeyStatus =
  (typeof UserExternalPrincipalKeyStatuses)[keyof typeof UserExternalPrincipalKeyStatuses];

export const userExternalPrincipalKeys = controlPlaneSchema.table(
  "user_external_principal_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("upk").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => userExternalPrincipals.id, { onDelete: "cascade" }),
    providerFamily: text("provider_family").notNull(),
    keyType: text("key_type").notNull(),
    keyValue: text("key_value").notNull(),
    status: text("status")
      .notNull()
      .$type<UserExternalPrincipalKeyStatus>()
      .default(UserExternalPrincipalKeyStatuses.ACTIVE),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    retiredAt: timestamp("retired_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    foreignKey({
      name: "user_ext_principal_keys_org_provider_principal_fkey",
      columns: [table.organizationId, table.providerFamily, table.principalId],
      foreignColumns: [
        userExternalPrincipals.organizationId,
        userExternalPrincipals.providerFamily,
        userExternalPrincipals.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("user_external_principal_keys_active_uidx")
      .on(table.organizationId, table.providerFamily, table.keyType, table.keyValue)
      .where(sql`${table.status} = 'active'`),
    index("user_external_principal_keys_principal_id_idx").on(table.principalId),
    index("user_external_principal_keys_org_provider_idx").on(
      table.organizationId,
      table.providerFamily,
    ),
  ],
);

export type UserExternalPrincipalKey = typeof userExternalPrincipalKeys.$inferSelect;
export type InsertUserExternalPrincipalKey = typeof userExternalPrincipalKeys.$inferInsert;
