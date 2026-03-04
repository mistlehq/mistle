import { boolean, index, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const AutomationKinds = {
  WEBHOOK: "webhook",
  SCHEDULE: "schedule",
} as const;

export type AutomationKind = (typeof AutomationKinds)[keyof typeof AutomationKinds];

export const automations = controlPlaneSchema.table(
  "automations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("atm").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().$type<AutomationKind>(),
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
    index("automations_organization_id_idx").on(table.organizationId),
    index("automations_organization_id_kind_idx").on(table.organizationId, table.kind),
    index("automations_organization_id_enabled_idx").on(table.organizationId, table.enabled),
  ],
);

export type Automation = typeof automations.$inferSelect;
export type InsertAutomation = typeof automations.$inferInsert;
