import { text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";

export const organizations = controlPlaneSchema.table(
  "organizations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("org").toString()),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
);
