import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { automationConversations } from "./automation-conversations.js";
import { controlPlaneSchema } from "./namespace.js";

export const AutomationConversationRouteStatuses = {
  ACTIVE: "active",
  CLOSED: "closed",
} as const;

export type AutomationConversationRouteStatus =
  (typeof AutomationConversationRouteStatuses)[keyof typeof AutomationConversationRouteStatuses];

export const automationConversationRoutes = controlPlaneSchema.table(
  "automation_conversation_routes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cvr").toString()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => automationConversations.id, { onDelete: "cascade" }),
    sandboxInstanceId: text("sandbox_instance_id").notNull(),
    providerConversationId: text("provider_conversation_id"),
    providerExecutionId: text("provider_execution_id"),
    providerState: jsonb("provider_state"),
    status: text("status").notNull().$type<AutomationConversationRouteStatus>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("automation_conversation_routes_automation_conversation_id_idx").on(table.conversationId),
    index("automation_conversation_routes_sandbox_instance_id_idx").on(table.sandboxInstanceId),
    uniqueIndex("automation_conversation_routes_automation_conversation_id_uidx").on(
      table.conversationId,
    ),
  ],
);

export type AutomationConversationRoute = typeof automationConversationRoutes.$inferSelect;
export type InsertAutomationConversationRoute = typeof automationConversationRoutes.$inferInsert;
