import {
  bigint,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  type PgSchema,
} from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { organizationCredentialKeys } from "./organization-credential-keys.js";
import { organizations } from "./organizations.js";
import { userExternalPrincipalCredentials } from "./user-external-principal-credentials.js";

export const UserExternalPrincipalCredentialSecretKinds = {
  OAUTH2_ACCESS_TOKEN: "oauth2_access_token",
  OAUTH2_REFRESH_TOKEN: "oauth2_refresh_token",
  PROVIDER_USER_TOKEN: "provider_user_token",
  GIT_SSH_PRIVATE_KEY: "git_ssh_private_key",
  GIT_GPG_PRIVATE_KEY: "git_gpg_private_key",
} as const;

export type UserExternalPrincipalCredentialSecretKind =
  (typeof UserExternalPrincipalCredentialSecretKinds)[keyof typeof UserExternalPrincipalCredentialSecretKinds];

export function defineUserExternalPrincipalCredentialSecrets(schema: PgSchema) {
  return schema.table(
    "user_external_principal_credential_secrets",
    {
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      credentialId: text("credential_id")
        .notNull()
        .references(() => userExternalPrincipalCredentials.id, { onDelete: "cascade" }),
      secretKind: text("secret_kind").$type<UserExternalPrincipalCredentialSecretKind>().notNull(),
      ciphertext: text("ciphertext").notNull(),
      nonce: text("nonce").notNull(),
      organizationCredentialKeyVersion: bigint("organization_credential_key_version", {
        mode: "number",
      }).notNull(),
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
      primaryKey({
        columns: [table.credentialId, table.secretKind],
      }),
      foreignKey({
        name: "user_ext_principal_cred_secrets_org_credential_fkey",
        columns: [table.organizationId, table.credentialId],
        foreignColumns: [
          userExternalPrincipalCredentials.organizationId,
          userExternalPrincipalCredentials.id,
        ],
      }).onDelete("cascade"),
      foreignKey({
        name: "user_ext_principal_cred_secrets_org_id_key_version_fkey",
        columns: [table.organizationId, table.organizationCredentialKeyVersion],
        foreignColumns: [
          organizationCredentialKeys.organizationId,
          organizationCredentialKeys.version,
        ],
      }).onDelete("restrict"),
      index("user_ext_principal_cred_secrets_org_id_idx").on(table.organizationId),
      index("user_ext_principal_cred_secrets_cred_id_idx").on(table.credentialId),
      index("user_ext_principal_cred_secrets_org_key_version_idx").on(
        table.organizationId,
        table.organizationCredentialKeyVersion,
      ),
    ],
  );
}

export const userExternalPrincipalCredentialSecrets =
  defineUserExternalPrincipalCredentialSecrets(controlPlaneSchema);

export type UserExternalPrincipalCredentialSecret =
  typeof userExternalPrincipalCredentialSecrets.$inferSelect;
export type InsertUserExternalPrincipalCredentialSecret =
  typeof userExternalPrincipalCredentialSecrets.$inferInsert;
