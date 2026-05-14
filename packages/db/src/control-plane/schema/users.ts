import { sql } from "drizzle-orm";
import { boolean, check, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";

export const UserAppearances = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
} as const;

export type UserAppearance = (typeof UserAppearances)[keyof typeof UserAppearances];

export function defineUsers(schema: PgSchema) {
  return schema.table(
    "users",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("usr").toString()),
      name: text("name").notNull(),
      email: text("email").notNull(),
      emailVerified: boolean("email_verified").notNull().default(false),
      image: text("image"),
      imageObjectKey: text("image_object_key"),
      appearance: text("appearance")
        .$type<UserAppearance>()
        .notNull()
        .default(UserAppearances.SYSTEM),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      uniqueIndex("users_email_uidx").on(table.email),
      check("users_appearance_check", sql`${table.appearance} in ('system', 'light', 'dark')`),
    ],
  );
}

export const users = defineUsers(controlPlaneSchema);
