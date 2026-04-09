import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationConnections } from "./integration-connections.js";
import { integrationCredentials } from "./integration-credentials.js";
import { integrationTargets } from "./integration-targets.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const IntegrationWebhookSourceStatuses = {
  ACTIVE: "active",
  ERROR: "error",
  DISABLED: "disabled",
} as const;

export type IntegrationWebhookSourceStatus =
  (typeof IntegrationWebhookSourceStatuses)[keyof typeof IntegrationWebhookSourceStatuses];

export const integrationWebhookSources = controlPlaneSchema.table(
  "integration_webhook_sources",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("iws").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }),
    integrationConnectionId: text("integration_connection_id")
      .notNull()
      .references(() => integrationConnections.id, {
        onDelete: "cascade",
      }),
    targetKey: text("target_key")
      .notNull()
      .references(() => integrationTargets.targetKey, {
        onDelete: "restrict",
      }),
    displayName: text("display_name"),
    endpointKey: text("endpoint_key").notNull(),
    webhookSecretCredentialId: text("webhook_secret_credential_id").references(
      () => integrationCredentials.id,
      { onDelete: "set null" },
    ),
    remoteRegistrationId: text("remote_registration_id"),
    status: text("status")
      .notNull()
      .$type<IntegrationWebhookSourceStatus>()
      .default(IntegrationWebhookSourceStatuses.ACTIVE),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_webhook_sources_endpoint_key_uidx").on(table.endpointKey),
    index("integration_webhook_sources_organization_id_idx").on(table.organizationId),
    index("integration_webhook_sources_integration_connection_id_idx").on(
      table.integrationConnectionId,
    ),
    index("integration_webhook_sources_target_key_idx").on(table.targetKey),
    index("integration_webhook_sources_status_idx").on(table.status),
    index("integration_webhook_sources_webhook_secret_credential_id_idx").on(
      table.webhookSecretCredentialId,
    ),
  ],
);

export type IntegrationWebhookSource = typeof integrationWebhookSources.$inferSelect;
export type InsertIntegrationWebhookSource = typeof integrationWebhookSources.$inferInsert;
