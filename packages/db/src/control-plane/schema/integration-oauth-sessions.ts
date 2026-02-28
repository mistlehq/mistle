import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationTargets } from "./integration-targets.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const integrationOauthSessions = controlPlaneSchema.table(
  "integration_oauth_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ios").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetKey: text("target_key")
      .notNull()
      .references(() => integrationTargets.targetKey, { onDelete: "restrict" }),
    state: text("state").notNull(),
    pkceVerifierEncrypted: text("pkce_verifier_encrypted"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("integration_oauth_sessions_organization_id_idx").on(table.organizationId),
    index("integration_oauth_sessions_organization_id_target_key_idx").on(
      table.organizationId,
      table.targetKey,
    ),
    uniqueIndex("integration_oauth_sessions_state_uidx").on(table.state),
    index("integration_oauth_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export type IntegrationOauthSession = typeof integrationOauthSessions.$inferSelect;
export type InsertIntegrationOauthSession = typeof integrationOauthSessions.$inferInsert;
