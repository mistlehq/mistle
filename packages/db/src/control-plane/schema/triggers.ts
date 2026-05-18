import { boolean, index, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const TriggerKinds = {
  WEBHOOK: "webhook",
  SCHEDULE: "schedule",
} as const;

export type TriggerKind = (typeof TriggerKinds)[keyof typeof TriggerKinds];

export function defineTriggers(schema: PgSchema) {
  return schema.table(
    "triggers",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("trg").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      kind: text("kind").notNull().$type<TriggerKind>(),
      name: text("name").notNull(),
      enabled: boolean("enabled").notNull().default(true),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("triggers_organization_id_kind_idx").on(table.organizationId, table.kind),
      index("triggers_organization_id_enabled_idx").on(table.organizationId, table.enabled),
      index("triggers_organization_id_created_at_id_idx").on(
        table.organizationId,
        table.createdAt,
        table.id,
      ),
    ],
  );
}

export const triggers = defineTriggers(controlPlaneSchema);

export type Trigger = typeof triggers.$inferSelect;
export type InsertTrigger = typeof triggers.$inferInsert;
