import { sql } from "drizzle-orm";
import { foreignKey, index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { userExternalPrincipals } from "./user-external-principals.js";

export const UserExternalPrincipalCredentialStatuses = {
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
  REAUTHORIZATION_REQUIRED: "reauthorization_required",
} as const;

export type UserExternalPrincipalCredentialStatus =
  (typeof UserExternalPrincipalCredentialStatuses)[keyof typeof UserExternalPrincipalCredentialStatuses];

export const userExternalPrincipalCredentials = controlPlaneSchema.table(
  "user_external_principal_credentials",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("upc").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    principalId: text("principal_id")
      .notNull()
      .references(() => userExternalPrincipals.id, { onDelete: "cascade" }),
    providerFamily: text("provider_family").notNull(),
    credentialKind: text("credential_kind").notNull(),
    status: text("status")
      .notNull()
      .$type<UserExternalPrincipalCredentialStatus>()
      .default(UserExternalPrincipalCredentialStatuses.ACTIVE),
    scopes: jsonb("scopes").$type<string[]>(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "user_ext_principal_creds_org_provider_principal_fkey",
      columns: [table.organizationId, table.providerFamily, table.principalId],
      foreignColumns: [
        userExternalPrincipals.organizationId,
        userExternalPrincipals.providerFamily,
        userExternalPrincipals.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("user_external_principal_creds_org_id_uidx").on(table.organizationId, table.id),
    index("user_external_principal_creds_principal_id_idx").on(table.principalId),
    uniqueIndex("user_external_principal_creds_active_kind_uidx")
      .on(table.principalId, table.credentialKind)
      .where(sql`${table.status} = 'active'`),
    index("user_external_principal_creds_org_provider_idx").on(
      table.organizationId,
      table.providerFamily,
    ),
  ],
);

export type UserExternalPrincipalCredential = typeof userExternalPrincipalCredentials.$inferSelect;
export type InsertUserExternalPrincipalCredential =
  typeof userExternalPrincipalCredentials.$inferInsert;
