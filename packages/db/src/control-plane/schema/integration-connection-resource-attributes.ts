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

import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";

export const IntegrationConnectionResourceAttributeValueTypes = {
  BOOLEAN: "boolean",
  NUMBER: "number",
  STRING: "string",
} as const;

export type IntegrationConnectionResourceAttributeValueType =
  (typeof IntegrationConnectionResourceAttributeValueTypes)[keyof typeof IntegrationConnectionResourceAttributeValueTypes];

export function defineIntegrationConnectionResourceAttributes(schema: PgSchema) {
  return schema.table(
    "integration_connection_resource_attributes",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("ica").toString()),
      connectionId: text("connection_id").notNull(),
      familyId: text("family_id").notNull(),
      resourceKind: text("resource_kind").notNull(),
      resourceExternalId: text("resource_external_id"),
      resourceHandle: text("resource_handle").notNull(),
      attributeKey: text("attribute_key").notNull(),
      attributeValue: text("attribute_value").notNull(),
      valueType: text("value_type")
        .notNull()
        .$type<IntegrationConnectionResourceAttributeValueType>(),
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
        name: "ic_resource_attributes_connection_id_fkey",
        columns: [table.connectionId],
        foreignColumns: [integrationConnections.id],
      }).onDelete("cascade"),
      uniqueIndex("ic_resource_attributes_connection_kind_handle_key_uidx").on(
        table.connectionId,
        table.resourceKind,
        table.resourceHandle,
        table.attributeKey,
      ),
      index("ic_resource_attributes_external_lookup_idx").on(
        table.connectionId,
        table.resourceKind,
        table.resourceExternalId,
        table.attributeKey,
        table.removedAt,
      ),
      index("ic_resource_attributes_value_lookup_idx").on(
        table.connectionId,
        table.resourceKind,
        table.attributeKey,
        table.attributeValue,
        table.removedAt,
      ),
      index("ic_resource_attributes_handle_lookup_idx").on(
        table.connectionId,
        table.resourceKind,
        table.resourceHandle,
        table.attributeKey,
        table.removedAt,
      ),
      index("ic_resource_attributes_scope_cleanup_idx").on(
        table.connectionId,
        table.familyId,
        table.resourceKind,
        table.removedAt,
      ),
    ],
  );
}

export const integrationConnectionResourceAttributes =
  defineIntegrationConnectionResourceAttributes(controlPlaneSchema);

export type IntegrationConnectionResourceAttribute =
  typeof integrationConnectionResourceAttributes.$inferSelect;
export type InsertIntegrationConnectionResourceAttribute =
  typeof integrationConnectionResourceAttributes.$inferInsert;
