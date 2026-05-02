import { text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";

export function defineOrganizations(schema: PgSchema) {
  return schema.table(
    "organizations",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("org").toString()),
      name: text("name").notNull(),
      slug: text("slug").notNull(),
      logo: text("logo"),
      logoObjectKey: text("logo_object_key"),
      metadata: text("metadata"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
  );
}

export const organizations = defineOrganizations(controlPlaneSchema);
