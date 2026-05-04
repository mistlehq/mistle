import { index, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";

export function defineVerifications(schema: PgSchema) {
  return schema.table(
    "verifications",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("vrf").toString()),
      identifier: text("identifier").notNull(),
      value: text("value").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index("verifications_identifier_idx").on(table.identifier)],
  );
}

export const verifications = defineVerifications(controlPlaneSchema);
