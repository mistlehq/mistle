import { index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";

export function defineProviderResourceAssociations(schema: PgSchema) {
  return schema.table(
    "provider_resource_associations",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("pra").toString()),
      integrationConnectionId: text("integration_connection_id")
        .notNull()
        .references(() => integrationConnections.id, { onDelete: "cascade" }),
      resourceKind: text("resource_kind").notNull(),
      providerResourceId: text("provider_resource_id").notNull(),
      sandboxInstanceId: text("sandbox_instance_id").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("provider_resource_associations_resource_instance_uidx").on(
        table.integrationConnectionId,
        table.resourceKind,
        table.providerResourceId,
        table.sandboxInstanceId,
      ),
      index("provider_resource_associations_resource_lookup_idx").on(
        table.integrationConnectionId,
        table.resourceKind,
        table.providerResourceId,
      ),
      index("provider_resource_associations_sandbox_instance_id_idx").on(table.sandboxInstanceId),
    ],
  );
}

export const providerResourceAssociations = defineProviderResourceAssociations(controlPlaneSchema);

export type ProviderResourceAssociation = typeof providerResourceAssociations.$inferSelect;
export type InsertProviderResourceAssociation = typeof providerResourceAssociations.$inferInsert;
