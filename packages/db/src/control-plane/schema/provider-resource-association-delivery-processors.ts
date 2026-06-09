import { bigint, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { providerResourceAssociations } from "./provider-resource-associations.js";

export const ProviderResourceAssociationDeliveryProcessorStatuses = {
  IDLE: "idle",
  RUNNING: "running",
} as const;

export type ProviderResourceAssociationDeliveryProcessorStatus =
  (typeof ProviderResourceAssociationDeliveryProcessorStatuses)[keyof typeof ProviderResourceAssociationDeliveryProcessorStatuses];

export function defineProviderResourceAssociationDeliveryProcessors(schema: PgSchema) {
  return schema.table("provider_resource_association_delivery_processors", {
    providerResourceAssociationId: text("provider_resource_association_id")
      .primaryKey()
      .references(() => providerResourceAssociations.id, { onDelete: "cascade" }),
    generation: bigint("generation", { mode: "number" }).notNull().default(0),
    status: text("status")
      .notNull()
      .$type<ProviderResourceAssociationDeliveryProcessorStatus>()
      .default(ProviderResourceAssociationDeliveryProcessorStatuses.IDLE),
    activeWorkflowRunId: text("active_workflow_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  });
}

export const providerResourceAssociationDeliveryProcessors =
  defineProviderResourceAssociationDeliveryProcessors(controlPlaneSchema);

export type ProviderResourceAssociationDeliveryProcessor =
  typeof providerResourceAssociationDeliveryProcessors.$inferSelect;
export type InsertProviderResourceAssociationDeliveryProcessor =
  typeof providerResourceAssociationDeliveryProcessors.$inferInsert;
