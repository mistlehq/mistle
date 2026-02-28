import { bigint, index, text, uniqueIndex, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const organizationCredentialKeys = controlPlaneSchema.table(
  "organization_credential_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ock").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull(),
    masterKeyVersion: bigint("master_key_version", { mode: "number" }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("organization_credential_keys_organization_id_idx").on(table.organizationId),
    uniqueIndex("organization_credential_keys_organization_id_version_uidx").on(
      table.organizationId,
      table.version,
    ),
  ],
);

export type OrganizationCredentialKey = typeof organizationCredentialKeys.$inferSelect;
export type InsertOrganizationCredentialKey = typeof organizationCredentialKeys.$inferInsert;
