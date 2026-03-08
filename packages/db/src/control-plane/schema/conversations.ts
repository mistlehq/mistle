import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const ConversationOwnerKinds = {
  AUTOMATION_TARGET: "automation_target",
  INTEGRATION_BINDING: "integration_binding",
} as const;

export type ConversationOwnerKind =
  (typeof ConversationOwnerKinds)[keyof typeof ConversationOwnerKinds];

export const ConversationCreatedByKinds = {
  USER: "user",
  WEBHOOK: "webhook",
  SCHEDULE: "schedule",
} as const;

export type ConversationCreatedByKind =
  (typeof ConversationCreatedByKinds)[keyof typeof ConversationCreatedByKinds];

export const ConversationProviderFamilies = {
  CODEX: "codex",
} as const;

export type ConversationProviderFamily =
  (typeof ConversationProviderFamilies)[keyof typeof ConversationProviderFamilies];

export const ConversationStatuses = {
  PENDING: "pending",
  ACTIVE: "active",
  CLOSED: "closed",
} as const;

export type ConversationStatus = (typeof ConversationStatuses)[keyof typeof ConversationStatuses];

export const conversations = controlPlaneSchema.table(
  "conversations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cnv").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerKind: text("owner_kind").notNull().$type<ConversationOwnerKind>(),
    ownerId: text("owner_id").notNull(),
    createdByKind: text("created_by_kind").notNull().$type<ConversationCreatedByKind>(),
    createdById: text("created_by_id").notNull(),
    sandboxProfileId: text("sandbox_profile_id")
      .notNull()
      .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
    providerFamily: text("provider_family").notNull().$type<ConversationProviderFamily>(),
    conversationKey: text("conversation_key").notNull(),
    title: text("title"),
    preview: text("preview"),
    lastProcessedSourceOrderKey: text("last_processed_source_order_key"),
    lastProcessedWebhookEventId: text("last_processed_webhook_event_id").references(
      () => integrationWebhookEvents.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().$type<ConversationStatus>(),
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
    uniqueIndex("conversations_org_owner_key_uidx").on(
      table.organizationId,
      table.ownerKind,
      table.ownerId,
      table.conversationKey,
    ),
    index("conversations_organization_id_idx").on(table.organizationId),
    index("conversations_sandbox_profile_id_idx").on(table.sandboxProfileId),
    index("conversations_last_processed_webhook_event_id_idx").on(
      table.lastProcessedWebhookEventId,
    ),
    index("conversations_org_owner_idx").on(table.organizationId, table.ownerKind, table.ownerId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = typeof conversations.$inferInsert;
