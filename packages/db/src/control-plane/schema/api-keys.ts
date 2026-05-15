import { index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const ApiKeyActorKinds = {
  USER: "user",
  AGENT: "agent",
} as const;

export type ApiKeyActorKind = (typeof ApiKeyActorKinds)[keyof typeof ApiKeyActorKinds];

export function defineApiKeys(schema: PgSchema) {
  return schema.table(
    "api_keys",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("apk").toString()),
      name: text("name").notNull(),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      secretPrefix: text("secret_prefix").notNull(),
      secretHash: text("secret_hash").notNull(),
      secretHashAlgorithm: text("secret_hash_algorithm").notNull(),
      createdByActorKind: text("created_by_actor_kind").$type<ApiKeyActorKind>().notNull(),
      createdByActorId: text("created_by_actor_id").notNull(),
      revokedByActorKind: text("revoked_by_actor_kind").$type<ApiKeyActorKind>(),
      revokedByActorId: text("revoked_by_actor_id"),
      expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
      revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("api_keys_secret_prefix_uidx").on(table.secretPrefix),
      index("api_keys_organization_id_revoked_at_idx").on(table.organizationId, table.revokedAt),
    ],
  );
}

export const apiKeys = defineApiKeys(controlPlaneSchema);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;
