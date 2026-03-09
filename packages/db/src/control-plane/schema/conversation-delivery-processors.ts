import { bigint, text, timestamp } from "drizzle-orm/pg-core";

import { conversations } from "./conversations.js";
import { controlPlaneSchema } from "./namespace.js";

export const ConversationDeliveryProcessorStatuses = {
  IDLE: "idle",
  RUNNING: "running",
} as const;

export type ConversationDeliveryProcessorStatus =
  (typeof ConversationDeliveryProcessorStatuses)[keyof typeof ConversationDeliveryProcessorStatuses];

export const conversationDeliveryProcessors = controlPlaneSchema.table(
  "conversation_delivery_processors",
  {
    conversationId: text("conversation_id")
      .primaryKey()
      .references(() => conversations.id, { onDelete: "cascade" }),
    generation: bigint("generation", { mode: "number" }).notNull().default(0),
    status: text("status")
      .notNull()
      .$type<ConversationDeliveryProcessorStatus>()
      .default(ConversationDeliveryProcessorStatuses.IDLE),
    activeWorkflowRunId: text("active_workflow_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
);

export type ConversationDeliveryProcessor = typeof conversationDeliveryProcessors.$inferSelect;
export type InsertConversationDeliveryProcessor =
  typeof conversationDeliveryProcessors.$inferInsert;
