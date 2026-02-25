import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

export const MemberRoles = {
  MEMBER: "member",
  ADMIN: "admin",
  OWNER: "owner",
} as const;

export type MemberRole = (typeof MemberRoles)[keyof typeof MemberRoles];

export const members = controlPlaneSchema.table(
  "members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("mbr").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<MemberRole>().default(MemberRoles.MEMBER),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("members_org_user_uidx").on(table.organizationId, table.userId),
    index("members_organization_id_idx").on(table.organizationId),
    index("members_user_id_idx").on(table.userId),
  ],
);
