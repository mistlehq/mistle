import { bigint, foreignKey, index, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizationCredentialKeys } from "./organization-credential-keys.js";
import { organizations } from "./organizations.js";

export const IntegrationCredentialSecretKinds = {
  API_KEY: "api_key",
} as const;

export type IntegrationCredentialSecretKind =
  (typeof IntegrationCredentialSecretKinds)[keyof typeof IntegrationCredentialSecretKinds];

export const integrationCredentials = controlPlaneSchema.table(
  "integration_credentials",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("icr").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    secretKind: text("secret_kind").$type<IntegrationCredentialSecretKind>().notNull(),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    organizationCredentialKeyVersion: bigint("organization_credential_key_version", {
      mode: "number",
    }).notNull(),
    intendedFamilyId: text("intended_family_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "integration_credentials_org_id_org_key_version_fkey",
      columns: [table.organizationId, table.organizationCredentialKeyVersion],
      foreignColumns: [
        organizationCredentialKeys.organizationId,
        organizationCredentialKeys.version,
      ],
    }).onDelete("restrict"),
    index("integration_credentials_organization_id_idx").on(table.organizationId),
    index("integration_credentials_organization_id_secret_kind_idx").on(
      table.organizationId,
      table.secretKind,
    ),
    index("integration_credentials_organization_id_key_version_idx").on(
      table.organizationId,
      table.organizationCredentialKeyVersion,
    ),
  ],
);

export type IntegrationCredential = typeof integrationCredentials.$inferSelect;
export type InsertIntegrationCredential = typeof integrationCredentials.$inferInsert;
