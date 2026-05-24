import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";

export function defineOAuthServerStates(schema: PgSchema) {
  return schema.table(
    "oauth_server_states",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("oss").toString()),
      modelName: text("model_name").notNull(),
      recordId: text("record_id").notNull(),
      payload: jsonb("payload").notNull(),
      grantId: text("grant_id"),
      userCode: text("user_code"),
      uid: text("uid"),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
      consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("oauth_server_states_model_name_record_id_uidx").on(
        table.modelName,
        table.recordId,
      ),
      uniqueIndex("oauth_server_states_model_name_user_code_uidx")
        .on(table.modelName, table.userCode)
        .where(sql`${table.userCode} is not null`),
      index("oauth_server_states_grant_id_idx").on(table.grantId),
      index("oauth_server_states_expires_at_idx").on(table.expiresAt),
    ],
  );
}

export const oauthServerStates = defineOAuthServerStates(controlPlaneSchema);

export type OAuthServerState = typeof oauthServerStates.$inferSelect;
export type InsertOAuthServerState = typeof oauthServerStates.$inferInsert;
