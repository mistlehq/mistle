import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { controlPlaneSchema } from "./namespace.js";

export const IntegrationConnectionResourceStatuses = {
  ACCESSIBLE: "accessible",
  UNAVAILABLE: "unavailable",
} as const;

export type IntegrationConnectionResourceStatus =
  (typeof IntegrationConnectionResourceStatuses)[keyof typeof IntegrationConnectionResourceStatuses];

export const integrationConnectionResources = controlPlaneSchema.table(
  "integration_connection_resources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("rsc").toString()),
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    familyId: text("family_id").notNull(),
    kind: text("kind").notNull(),
    externalId: text("external_id"),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status")
      .notNull()
      .$type<IntegrationConnectionResourceStatus>()
      .default(IntegrationConnectionResourceStatuses.ACCESSIBLE),
    unavailableReason: text("unavailable_reason"),
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
    uniqueIndex("integration_connection_resources_connection_id_kind_handle_unique").on(
      table.connectionId,
      table.kind,
      table.handle,
    ),
    uniqueIndex("integration_connection_resources_connection_id_kind_external_id_unique").on(
      table.connectionId,
      table.kind,
      table.externalId,
    ),
    index("integration_connection_resources_connection_id_kind_status_idx").on(
      table.connectionId,
      table.kind,
      table.status,
    ),
    index("integration_connection_resources_connection_id_family_id_kind_idx").on(
      table.connectionId,
      table.familyId,
      table.kind,
    ),
    index("integration_connection_resources_connection_id_kind_display_name_idx").on(
      table.connectionId,
      table.kind,
      table.displayName,
    ),
  ],
);

export type IntegrationConnectionResource = typeof integrationConnectionResources.$inferSelect;
export type InsertIntegrationConnectionResource =
  typeof integrationConnectionResources.$inferInsert;
