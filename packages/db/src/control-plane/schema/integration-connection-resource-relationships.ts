import {
  foreignKey,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  type PgSchema,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnectionResources } from "./integration-connection-resources.js";
import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";

export function defineIntegrationConnectionResourceRelationships(schema: PgSchema) {
  return schema.table(
    "integration_connection_resource_relationships",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("irr").toString()),
      connectionId: text("connection_id").notNull(),
      familyId: text("family_id").notNull(),
      relationshipKind: text("relationship_kind").notNull(),
      subjectResourceId: text("subject_resource_id"),
      subjectResourceKind: text("subject_resource_kind").notNull(),
      subjectExternalId: text("subject_external_id"),
      subjectHandle: text("subject_handle").notNull(),
      objectResourceId: text("object_resource_id"),
      objectResourceKind: text("object_resource_kind").notNull(),
      objectExternalId: text("object_external_id"),
      objectHandle: text("object_handle").notNull(),
      scopeResourceId: text("scope_resource_id"),
      scopeKind: text("scope_kind").notNull(),
      scopeExternalId: text("scope_external_id"),
      scopeHandle: text("scope_handle").notNull(),
      metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }).notNull(),
      removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
    },
    (table) => [
      foreignKey({
        name: "ic_resource_relationships_connection_id_fkey",
        columns: [table.connectionId],
        foreignColumns: [integrationConnections.id],
      }).onDelete("cascade"),
      foreignKey({
        name: "ic_resource_relationships_subject_resource_id_fkey",
        columns: [table.connectionId, table.subjectResourceId],
        foreignColumns: [
          integrationConnectionResources.connectionId,
          integrationConnectionResources.id,
        ],
      }),
      foreignKey({
        name: "ic_resource_relationships_object_resource_id_fkey",
        columns: [table.connectionId, table.objectResourceId],
        foreignColumns: [
          integrationConnectionResources.connectionId,
          integrationConnectionResources.id,
        ],
      }),
      foreignKey({
        name: "ic_resource_relationships_scope_resource_id_fkey",
        columns: [table.connectionId, table.scopeResourceId],
        foreignColumns: [
          integrationConnectionResources.connectionId,
          integrationConnectionResources.id,
        ],
      }),
      uniqueIndex("ic_resource_relationships_connection_edge_scope_uidx").on(
        table.connectionId,
        table.relationshipKind,
        table.subjectResourceKind,
        table.subjectHandle,
        table.objectResourceKind,
        table.objectHandle,
        table.scopeKind,
        table.scopeHandle,
      ),
      index("ic_resource_relationships_subject_lookup_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.subjectResourceKind,
        table.subjectExternalId,
        table.removedAt,
      ),
      index("ic_resource_relationships_exact_external_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.subjectResourceKind,
        table.subjectExternalId,
        table.objectResourceKind,
        table.objectExternalId,
        table.removedAt,
      ),
      index("ic_resource_relationships_exact_resource_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.subjectResourceId,
        table.objectResourceId,
        table.removedAt,
      ),
      index("ic_resource_relationships_object_lookup_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.objectResourceKind,
        table.objectExternalId,
        table.removedAt,
      ),
      index("ic_resource_relationships_scope_cleanup_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.scopeKind,
        table.scopeExternalId,
        table.removedAt,
      ),
      index("ic_resource_relationships_scope_resource_cleanup_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.scopeResourceId,
        table.removedAt,
      ),
      index("ic_resource_relationships_handle_lookup_idx").on(
        table.connectionId,
        table.relationshipKind,
        table.subjectResourceKind,
        table.subjectHandle,
        table.objectResourceKind,
        table.objectHandle,
        table.removedAt,
      ),
    ],
  );
}

export const integrationConnectionResourceRelationships =
  defineIntegrationConnectionResourceRelationships(controlPlaneSchema);

export type IntegrationConnectionResourceRelationship =
  typeof integrationConnectionResourceRelationships.$inferSelect;
export type InsertIntegrationConnectionResourceRelationship =
  typeof integrationConnectionResourceRelationships.$inferInsert;
