import { index, jsonb, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { triggerConversations } from "./trigger-conversations.js";

export const TriggerConversationRouteStatuses = {
  ACTIVE: "active",
  CLOSED: "closed",
} as const;

export type TriggerConversationRouteStatus =
  (typeof TriggerConversationRouteStatuses)[keyof typeof TriggerConversationRouteStatuses];

export function defineTriggerConversationRoutes(schema: PgSchema) {
  return schema.table(
    "trigger_conversation_routes",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("cvr").toString()),
      conversationId: text("conversation_id")
        .notNull()
        .references(() => triggerConversations.id, { onDelete: "cascade" }),
      sandboxInstanceId: text("sandbox_instance_id").notNull(),
      providerConversationId: text("provider_conversation_id"),
      providerExecutionId: text("provider_execution_id"),
      providerState: jsonb("provider_state"),
      status: text("status").notNull().$type<TriggerConversationRouteStatus>(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("trigger_conversation_routes_sandbox_instance_id_idx").on(table.sandboxInstanceId),
      uniqueIndex("trigger_conversation_routes_trigger_conversation_id_uidx").on(
        table.conversationId,
      ),
    ],
  );
}

export const triggerConversationRoutes = defineTriggerConversationRoutes(controlPlaneSchema);

export type TriggerConversationRoute = typeof triggerConversationRoutes.$inferSelect;
export type InsertTriggerConversationRoute = typeof triggerConversationRoutes.$inferInsert;
