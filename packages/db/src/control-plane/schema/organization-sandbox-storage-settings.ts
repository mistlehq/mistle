import { bigint, boolean, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const SandboxStorageConfigSources = {
  MANAGED: "managed",
  ORGANIZATION: "organization",
} as const;

export const SandboxStorageBackend = {
  ARCHIL: "archil",
  DOCKER_VOLUME: "docker_volume",
} as const;

export type SandboxStorageConfigSource =
  (typeof SandboxStorageConfigSources)[keyof typeof SandboxStorageConfigSources];

export type SandboxStorageBackend =
  (typeof SandboxStorageBackend)[keyof typeof SandboxStorageBackend];

export const organizationSandboxStorageSettings = controlPlaneSchema.table(
  "organization_sandbox_storage_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sss").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    persistentSandboxesEnabled: boolean("persistent_sandboxes_enabled").notNull().default(false),
    storageBackend: text("storage_backend").$type<SandboxStorageBackend>(),
    storageConfigSource: text("storage_config_source")
      .notNull()
      .$type<SandboxStorageConfigSource>()
      .default(SandboxStorageConfigSources.MANAGED),
    storageConfigVersion: bigint("storage_config_version", { mode: "number" }),
    storageConfigCiphertext: text("storage_config_ciphertext"),
    storageConfigNonce: text("storage_config_nonce"),
    organizationCredentialKeyVersion: bigint("organization_credential_key_version", {
      mode: "number",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_sandbox_storage_settings_organization_id_uidx").on(
      table.organizationId,
    ),
  ],
);

export type OrganizationSandboxStorageSettings =
  typeof organizationSandboxStorageSettings.$inferSelect;
export type InsertOrganizationSandboxStorageSettings =
  typeof organizationSandboxStorageSettings.$inferInsert;
