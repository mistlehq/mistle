import { bigint, index, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";

export const IntegrationConnectionResourceSyncStates = {
  NEVER_SYNCED: "never-synced",
  SYNCING: "syncing",
  READY: "ready",
  ERROR: "error",
} as const;

export type IntegrationConnectionResourceSyncState =
  (typeof IntegrationConnectionResourceSyncStates)[keyof typeof IntegrationConnectionResourceSyncStates];

export const integrationConnectionResourceStates = controlPlaneSchema.table(
  "integration_connection_resource_states",
  {
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    familyId: text("family_id").notNull(),
    kind: text("kind").notNull(),
    syncState: text("sync_state")
      .notNull()
      .$type<IntegrationConnectionResourceSyncState>()
      .default(IntegrationConnectionResourceSyncStates.NEVER_SYNCED),
    totalCount: bigint("total_count", { mode: "number" }).notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true, mode: "string" }),
    lastSyncStartedAt: timestamp("last_sync_started_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastSyncFinishedAt: timestamp("last_sync_finished_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "integration_connection_resource_states_pk",
      columns: [table.connectionId, table.kind],
    }),
    index("integration_connection_resource_states_connection_id_family_id_kind_idx").on(
      table.connectionId,
      table.familyId,
      table.kind,
    ),
  ],
);

export type IntegrationConnectionResourceState =
  typeof integrationConnectionResourceStates.$inferSelect;
export type InsertIntegrationConnectionResourceState =
  typeof integrationConnectionResourceStates.$inferInsert;
