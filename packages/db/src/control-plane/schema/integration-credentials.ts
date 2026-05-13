import {
  bigint,
  foreignKey,
  index,
  jsonb,
  text,
  timestamp,
  type PgSchema,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizationCredentialKeys } from "./organization-credential-keys.js";
import { organizations } from "./organizations.js";

export const IntegrationCredentialSecretKinds = {
  API_KEY: "api_key",
  AWS_SECRET_ACCESS_KEY: "aws_secret_access_key",
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  OAUTH2_CLIENT_SECRET: "oauth2_client_secret",
  OAUTH2_REFRESH_TOKEN: "oauth2_refresh_token",
  WEBHOOK_SECRET: "webhook_secret",
} as const;

export type IntegrationCredentialSecretKind =
  (typeof IntegrationCredentialSecretKinds)[keyof typeof IntegrationCredentialSecretKinds];

export function defineIntegrationCredentials(schema: PgSchema) {
  return schema.table(
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
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
      revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
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
}

export const integrationCredentials = defineIntegrationCredentials(controlPlaneSchema);

export type IntegrationCredential = typeof integrationCredentials.$inferSelect;
export type InsertIntegrationCredential = typeof integrationCredentials.$inferInsert;
