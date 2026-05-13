import { index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { teams } from "./teams.js";
import { users } from "./users.js";

export function defineTeamMembers(schema: PgSchema) {
  return schema.table(
    "team_members",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("tmb").toString()),
      teamId: text("team_id")
        .notNull()
        .references(() => teams.id, { onDelete: "cascade" }),
      userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("team_members_team_user_uidx").on(table.teamId, table.userId),
      index("team_members_user_id_idx").on(table.userId),
    ],
  );
}

export const teamMembers = defineTeamMembers(controlPlaneSchema);
