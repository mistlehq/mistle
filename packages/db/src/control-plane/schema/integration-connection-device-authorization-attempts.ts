import { index, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { integrationTargets } from "./integration-targets.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const IntegrationDeviceAuthorizationAttemptStatuses = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type IntegrationDeviceAuthorizationAttemptStatus =
  (typeof IntegrationDeviceAuthorizationAttemptStatuses)[keyof typeof IntegrationDeviceAuthorizationAttemptStatuses];

export const integrationConnectionDeviceAuthorizationAttempts = controlPlaneSchema.table(
  "integration_connection_device_authorization_attempts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("ida").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetKey: text("target_key")
      .notNull()
      .references(() => integrationTargets.targetKey, { onDelete: "restrict" }),
    connectionMethodId: text("connection_method_id").notNull(),
    displayName: text("display_name"),
    status: text("status")
      .notNull()
      .$type<IntegrationDeviceAuthorizationAttemptStatus>()
      .default(IntegrationDeviceAuthorizationAttemptStatuses.PENDING),
    providerStateEncrypted: text("provider_state_encrypted").notNull(),
    verificationUrl: text("verification_url").notNull(),
    userCode: text("user_code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    pollAfterAt: timestamp("poll_after_at", { withTimezone: true, mode: "string" }),
    connectionId: text("connection_id").references(() => integrationConnections.id, {
      onDelete: "set null",
    }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("int_conn_dev_auth_attempts_org_idx").on(table.organizationId),
    index("int_conn_dev_auth_attempts_org_target_idx").on(table.organizationId, table.targetKey),
    index("int_conn_dev_auth_attempts_org_status_idx").on(table.organizationId, table.status),
    index("int_conn_dev_auth_attempts_expires_at_idx").on(table.expiresAt),
    index("int_conn_dev_auth_attempts_poll_after_at_idx").on(table.pollAfterAt),
    index("int_conn_dev_auth_attempts_connection_id_idx").on(table.connectionId),
  ],
);

export type IntegrationConnectionDeviceAuthorizationAttempt =
  typeof integrationConnectionDeviceAuthorizationAttempts.$inferSelect;
export type InsertIntegrationConnectionDeviceAuthorizationAttempt =
  typeof integrationConnectionDeviceAuthorizationAttempts.$inferInsert;
