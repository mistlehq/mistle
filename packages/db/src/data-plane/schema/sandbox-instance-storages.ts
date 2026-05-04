import { bigint, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";
import { defineSandboxInstances, sandboxInstances } from "./sandbox-instances.js";

export const SandboxStorageProviders = {
  ARCHIL: "archil",
  DOCKER_VOLUME: "docker_volume",
} as const;

export const SandboxStorageStatuses = {
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
} as const;

export const SandboxStorageCredentialKinds = {
  DISK_TOKEN: "disk_token",
} as const;

export type SandboxStorageProvider =
  (typeof SandboxStorageProviders)[keyof typeof SandboxStorageProviders];

export type SandboxStorageStatus =
  (typeof SandboxStorageStatuses)[keyof typeof SandboxStorageStatuses];

export type SandboxStorageCredentialKind =
  (typeof SandboxStorageCredentialKinds)[keyof typeof SandboxStorageCredentialKinds];

export function defineSandboxInstanceStorages(input: {
  schema: PgSchema;
  sandboxInstances: ReturnType<typeof defineSandboxInstances>;
}) {
  return input.schema.table(
    "sandbox_instance_storages",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("sto").toString()),
      sandboxInstanceId: text("sandbox_instance_id")
        .notNull()
        .references(() => input.sandboxInstances.id, { onDelete: "cascade" }),
      provider: text("provider").$type<SandboxStorageProvider>().notNull(),
      handle: text("handle").notNull(),
      region: text("region"),
      status: text("status")
        .notNull()
        .$type<SandboxStorageStatus>()
        .default(SandboxStorageStatuses.PENDING),
      credentialCiphertext: text("credential_ciphertext"),
      credentialNonce: text("credential_nonce"),
      credentialKind: text("credential_kind").$type<SandboxStorageCredentialKind>(),
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
      uniqueIndex("sandbox_instance_storages_sandbox_instance_id_uidx").on(table.sandboxInstanceId),
    ],
  );
}

export const sandboxInstanceStorages = defineSandboxInstanceStorages({
  schema: dataPlaneSchema,
  sandboxInstances,
});

export type SandboxInstanceStorage = typeof sandboxInstanceStorages.$inferSelect;
export type InsertSandboxInstanceStorage = typeof sandboxInstanceStorages.$inferInsert;
