import { index, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export function defineTeams(schema: PgSchema) {
  return schema.table(
    "teams",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("tem").toString()),
      name: text("name").notNull(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (table) => [index("teams_organization_id_idx").on(table.organizationId)],
  );
}

export const teams = defineTeams(controlPlaneSchema);
