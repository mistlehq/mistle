import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { conversations } from "./conversations.js";
import { controlPlaneSchema } from "./namespace.js";

export const ConversationRouteStatuses = {
  ACTIVE: "active",
  CLOSED: "closed",
} as const;

export type ConversationRouteStatus =
  (typeof ConversationRouteStatuses)[keyof typeof ConversationRouteStatuses];

export const conversationRoutes = controlPlaneSchema.table(
  "conversation_routes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("cvr").toString()),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sandboxInstanceId: text("sandbox_instance_id").notNull(),
    providerConversationId: text("provider_conversation_id"),
    providerExecutionId: text("provider_execution_id"),
    providerState: jsonb("provider_state"),
    status: text("status").notNull().$type<ConversationRouteStatus>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("conversation_routes_conversation_id_idx").on(table.conversationId),
    index("conversation_routes_sandbox_instance_id_idx").on(table.sandboxInstanceId),
    uniqueIndex("conversation_routes_conversation_id_uidx").on(table.conversationId),
  ],
);

export type ConversationRoute = typeof conversationRoutes.$inferSelect;
export type InsertConversationRoute = typeof conversationRoutes.$inferInsert;
