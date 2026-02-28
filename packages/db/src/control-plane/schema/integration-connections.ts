import { index, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const IntegrationConnectionStatuses = {
  ACTIVE: "active",
  ERROR: "error",
  REVOKED: "revoked",
} as const;

export type IntegrationConnectionStatus =
  (typeof IntegrationConnectionStatuses)[keyof typeof IntegrationConnectionStatuses];

export const integrationConnections = controlPlaneSchema.table(
  "integration_connections",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("icn").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetKey: text("target_key").notNull(),
    status: text("status")
      .notNull()
      .$type<IntegrationConnectionStatus>()
      .default(IntegrationConnectionStatuses.ACTIVE),
    externalSubjectId: text("external_subject_id"),
    config: jsonb("config").$type<Record<string, unknown>>(),
    targetSnapshotConfig: jsonb("target_snapshot_config").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("integration_connections_organization_id_idx").on(table.organizationId),
    index("integration_connections_organization_id_target_key_idx").on(
      table.organizationId,
      table.targetKey,
    ),
    index("integration_connections_organization_id_status_idx").on(
      table.organizationId,
      table.status,
    ),
  ],
);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type InsertIntegrationConnection = typeof integrationConnections.$inferInsert;
