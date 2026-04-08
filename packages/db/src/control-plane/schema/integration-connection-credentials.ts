import { index, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { integrationConnections } from "./integration-connections.js";
import { integrationCredentials } from "./integration-credentials.js";
import { controlPlaneSchema } from "./namespace.js";

export type IntegrationConnectionCredentialSlotKey = string;

export const integrationConnectionCredentials = controlPlaneSchema.table(
  "integration_connection_credentials",
  {
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    credentialId: text("credential_id")
      .notNull()
      .references(() => integrationCredentials.id, { onDelete: "restrict" }),
    slotKey: text("slot_key").$type<IntegrationConnectionCredentialSlotKey>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.connectionId, table.slotKey],
    }),
    index("integration_connection_credentials_credential_id_idx").on(table.credentialId),
  ],
);

export type IntegrationConnectionCredential = typeof integrationConnectionCredentials.$inferSelect;
export type InsertIntegrationConnectionCredential =
  typeof integrationConnectionCredentials.$inferInsert;
