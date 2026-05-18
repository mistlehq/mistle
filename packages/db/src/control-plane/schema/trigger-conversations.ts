import { index, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { integrationWebhookEvents } from "./integration-webhook-events.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const TriggerConversationOwnerKinds = {
  TRIGGER_TARGET: "trigger_target",
  INTEGRATION_BINDING: "integration_binding",
} as const;

export type TriggerConversationOwnerKind =
  (typeof TriggerConversationOwnerKinds)[keyof typeof TriggerConversationOwnerKinds];

export const TriggerConversationCreatedByKinds = {
  USER: "user",
  WEBHOOK: "webhook",
  SCHEDULE: "schedule",
} as const;

export type TriggerConversationCreatedByKind =
  (typeof TriggerConversationCreatedByKinds)[keyof typeof TriggerConversationCreatedByKinds];

export const TriggerConversationStatuses = {
  PENDING: "pending",
  ACTIVE: "active",
  CLOSED: "closed",
} as const;

export type TriggerConversationStatus =
  (typeof TriggerConversationStatuses)[keyof typeof TriggerConversationStatuses];

export function defineTriggerConversations(schema: PgSchema) {
  return schema.table(
    "trigger_conversations",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("cnv").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      ownerKind: text("owner_kind").notNull().$type<TriggerConversationOwnerKind>(),
      ownerId: text("owner_id").notNull(),
      createdByKind: text("created_by_kind").notNull().$type<TriggerConversationCreatedByKind>(),
      createdById: text("created_by_id").notNull(),
      sandboxProfileId: text("sandbox_profile_id")
        .notNull()
        .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
      integrationFamilyId: text("integration_family_id").notNull(),
      runtimeId: text("runtime_id").notNull(),
      conversationKey: text("conversation_key").notNull(),
      status: text("status").notNull().$type<TriggerConversationStatus>(),
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
      uniqueIndex("trigger_conversations_org_owner_key_uidx").on(
        table.organizationId,
        table.ownerKind,
        table.ownerId,
        table.conversationKey,
      ),
      index("trigger_conversations_sandbox_profile_id_idx").on(table.sandboxProfileId),
    ],
  );
}

export const triggerConversations = defineTriggerConversations(controlPlaneSchema);

export type TriggerConversation = typeof triggerConversations.$inferSelect;
export type InsertTriggerConversation = typeof triggerConversations.$inferInsert;
