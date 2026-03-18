import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationTargets } from "./integration-targets.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const integrationConnectionRedirectSessions = controlPlaneSchema.table(
  "integration_connection_redirect_sessions",
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
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("integration_connection_redirect_sessions_organization_id_idx").on(table.organizationId),
    index("integration_connection_redirect_sessions_organization_id_target_key_idx").on(
      table.organizationId,
      table.targetKey,
    ),
    uniqueIndex("integration_connection_redirect_sessions_state_uidx").on(table.state),
    index("integration_connection_redirect_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export type IntegrationConnectionRedirectSession =
  typeof integrationConnectionRedirectSessions.$inferSelect;
export type InsertIntegrationConnectionRedirectSession =
  typeof integrationConnectionRedirectSessions.$inferInsert;
