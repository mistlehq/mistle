import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const AutomationConversationOwnerKinds = {
  AUTOMATION_TARGET: "automation_target",
  INTEGRATION_BINDING: "integration_binding",
} as const;

export type AutomationConversationOwnerKind =
  (typeof AutomationConversationOwnerKinds)[keyof typeof AutomationConversationOwnerKinds];

export const AutomationConversationCreatedByKinds = {
  USER: "user",
  WEBHOOK: "webhook",
  SCHEDULE: "schedule",
} as const;

export type AutomationConversationCreatedByKind =
  (typeof AutomationConversationCreatedByKinds)[keyof typeof AutomationConversationCreatedByKinds];
export type AutomationConversationIntegrationFamilyId = string;

export const AutomationConversationStatuses = {
  PENDING: "pending",
  ACTIVE: "active",
  CLOSED: "closed",
} as const;

export type AutomationConversationStatus =
  (typeof AutomationConversationStatuses)[keyof typeof AutomationConversationStatuses];

export const automationConversations = controlPlaneSchema.table(
  "automation_conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cnv").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerKind: text("owner_kind").notNull().$type<AutomationConversationOwnerKind>(),
    ownerId: text("owner_id").notNull(),
    createdByKind: text("created_by_kind").notNull().$type<AutomationConversationCreatedByKind>(),
    createdById: text("created_by_id").notNull(),
    sandboxProfileId: text("sandbox_profile_id")
      .notNull()
      .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
    integrationFamilyId: text("integration_family_id")
      .notNull()
      .$type<AutomationConversationIntegrationFamilyId>(),
    conversationKey: text("conversation_key").notNull(),
    title: text("title"),
    preview: text("preview"),
    status: text("status").notNull().$type<AutomationConversationStatus>(),
    lastProcessedSourceOrderKey: text("last_processed_source_order_key"),
    lastProcessedWebhookEventId: text("last_processed_webhook_event_id").references(
      () => integrationWebhookEvents.id,
      {
        onDelete: "set null",
      },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("automation_conversations_org_owner_key_uidx").on(
      table.organizationId,
      table.ownerKind,
      table.ownerId,
      table.conversationKey,
    ),
    index("automation_conversations_organization_id_idx").on(table.organizationId),
    index("automation_conversations_sandbox_profile_id_idx").on(table.sandboxProfileId),
    index("automation_conversations_org_owner_idx").on(
      table.organizationId,
      table.ownerKind,
      table.ownerId,
    ),
  ],
);

export type AutomationConversation = typeof automationConversations.$inferSelect;
export type InsertAutomationConversation = typeof automationConversations.$inferInsert;
