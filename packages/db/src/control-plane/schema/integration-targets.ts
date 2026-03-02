import { boolean, index, jsonb, text, timestamp } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";

export type IntegrationTargetEncryptedSecrets = {
  ciphertext: string;
  nonce: string;
  masterKeyVersion: number;
};

export const integrationTargets = controlPlaneSchema.table(
  "integration_targets",
  {
    targetKey: text("target_key").primaryKey(),
    familyId: text("family_id").notNull(),
    variantId: text("variant_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull(),
    secrets: jsonb("secrets").$type<IntegrationTargetEncryptedSecrets>(),
    displayNameOverride: text("display_name_override"),
    descriptionOverride: text("description_override"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("integration_targets_family_id_variant_id_idx").on(table.familyId, table.variantId),
    index("integration_targets_enabled_idx").on(table.enabled),
  ],
);

export type IntegrationTarget = typeof integrationTargets.$inferSelect;
export type InsertIntegrationTarget = typeof integrationTargets.$inferInsert;
