import { primaryKey, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { apiKeys } from "./api-keys.js";
import { controlPlaneSchema } from "./namespace.js";

export function defineApiKeyPermissions(schema: PgSchema) {
  return schema.table(
    "api_key_permissions",
    {
      apiKeyId: text("api_key_id")
        .notNull()
        .references(() => apiKeys.id, { onDelete: "cascade" }),
      permission: text("permission").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "api_key_permissions_api_key_id_permission_pk",
        columns: [table.apiKeyId, table.permission],
      }),
    ],
  );
}

export const apiKeyPermissions = defineApiKeyPermissions(controlPlaneSchema);

export type ApiKeyPermission = typeof apiKeyPermissions.$inferSelect;
export type InsertApiKeyPermission = typeof apiKeyPermissions.$inferInsert;
