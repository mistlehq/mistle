import {
  bigint,
  foreignKey,
  index,
  primaryKey,
  text,
  timestamp,
  type PgSchema,
} from "drizzle-orm/pg-core";

import { integrationConnectionResources } from "./integration-connection-resources.js";
import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";

export const IntegrationConnectionResourceRelationshipSyncStates = {
  NEVER_SYNCED: "never-synced",
  SYNCING: "syncing",
  READY: "ready",
  ERROR: "error",
} as const;

export type IntegrationConnectionResourceRelationshipSyncState =
  (typeof IntegrationConnectionResourceRelationshipSyncStates)[keyof typeof IntegrationConnectionResourceRelationshipSyncStates];

export function defineIntegrationConnectionResourceRelationshipStates(schema: PgSchema) {
  return schema.table(
    "integration_connection_resource_relationship_states",
    {
      connectionId: text("connection_id").notNull(),
      familyId: text("family_id").notNull(),
      relationshipKind: text("relationship_kind").notNull(),
      scopeResourceId: text("scope_resource_id"),
      scopeKind: text("scope_kind").notNull(),
      scopeExternalId: text("scope_external_id"),
      scopeHandle: text("scope_handle").notNull(),
      syncState: text("sync_state")
        .notNull()
        .$type<IntegrationConnectionResourceRelationshipSyncState>()
        .default(IntegrationConnectionResourceRelationshipSyncStates.NEVER_SYNCED),
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
      foreignKey({
        name: "ic_resource_relationship_states_connection_id_fkey",
        columns: [table.connectionId],
        foreignColumns: [integrationConnections.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "ic_resource_relationship_states_scope_resource_id_fkey",
        columns: [table.connectionId, table.scopeResourceId],
        foreignColumns: [
          integrationConnectionResources.connectionId,
          integrationConnectionResources.id,
        ],
      }),
      primaryKey({
        name: "ic_resource_relationship_states_pk",
        columns: [table.connectionId, table.relationshipKind, table.scopeKind, table.scopeHandle],
      }),
      index("ic_resource_relationship_states_external_scope_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.scopeKind,
        table.scopeExternalId,
      ),
      index("ic_resource_relationship_states_scope_resource_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.scopeResourceId,
      ),
      index("ic_resource_relationship_states_family_kind_idx").on(
        table.connectionId,
        table.familyId,
        table.relationshipKind,
      ),
    ],
  );
}

export const integrationConnectionResourceRelationshipStates =
  defineIntegrationConnectionResourceRelationshipStates(controlPlaneSchema);

export type IntegrationConnectionResourceRelationshipState =
  typeof integrationConnectionResourceRelationshipStates.$inferSelect;
export type InsertIntegrationConnectionResourceRelationshipState =
  typeof integrationConnectionResourceRelationshipStates.$inferInsert;
