import { bigint, index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const PortAccessLinkCreatedByKinds = {
  USER: "user",
  AGENT: "agent",
} as const;

export type PortAccessLinkCreatedByKind =
  (typeof PortAccessLinkCreatedByKinds)[keyof typeof PortAccessLinkCreatedByKinds];

export function definePortAccessLinks(schema: PgSchema) {
  return schema.table(
    "port_access_links",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("pal").toString()),
      slug: text("slug").notNull(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      sandboxInstanceId: text("sandbox_instance_id").notNull(),
      port: bigint("port", { mode: "number" }).notNull(),
      createdByKind: text("created_by_kind").notNull().$type<PortAccessLinkCreatedByKind>(),
      createdById: text("created_by_id").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("port_access_links_slug_uidx").on(table.slug),
      index("port_access_links_organization_created_at_idx").on(
        table.organizationId,
        table.createdAt,
      ),
      index("port_access_links_sandbox_instance_created_at_idx").on(
        table.sandboxInstanceId,
        table.createdAt,
      ),
      index("port_access_links_expires_at_idx").on(table.expiresAt),
    ],
  );
}

export const portAccessLinks = definePortAccessLinks(controlPlaneSchema);

export type PortAccessLink = typeof portAccessLinks.$inferSelect;
export type InsertPortAccessLink = typeof portAccessLinks.$inferInsert;
