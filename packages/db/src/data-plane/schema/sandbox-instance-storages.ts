import { bigint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";
import { sandboxInstances } from "./sandbox-instances.js";

export const SandboxStorageProviders = {
  ARCHIL: "archil",
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

export const sandboxInstanceStorages = dataPlaneSchema.table(
  "sandbox_instance_storages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sto").toString()),
    sandboxInstanceId: text("sandbox_instance_id")
      .notNull()
      .references(() => sandboxInstances.id, { onDelete: "cascade" }),
    provider: text("provider").$type<SandboxStorageProvider>().notNull(),
    handle: text("handle").notNull(),
    region: text("region").notNull(),
    status: text("status")
      .notNull()
      .$type<SandboxStorageStatus>()
      .default(SandboxStorageStatuses.PENDING),
    credentialCiphertext: text("credential_ciphertext").notNull(),
    credentialNonce: text("credential_nonce").notNull(),
    credentialKind: text("credential_kind")
      .notNull()
      .$type<SandboxStorageCredentialKind>()
      .default(SandboxStorageCredentialKinds.DISK_TOKEN),
    organizationCredentialKeyVersion: bigint("organization_credential_key_version", {
      mode: "number",
    }).notNull(),
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

export type SandboxInstanceStorage = typeof sandboxInstanceStorages.$inferSelect;
export type InsertSandboxInstanceStorage = typeof sandboxInstanceStorages.$inferInsert;
