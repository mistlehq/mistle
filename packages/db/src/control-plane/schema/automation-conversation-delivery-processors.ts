import { bigint, text, timestamp } from "drizzle-orm/pg-core";

import { automationConversations } from "./automation-conversations.js";
import { controlPlaneSchema } from "./namespace.js";

export const AutomationConversationDeliveryProcessorStatuses = {
  IDLE: "idle",
  RUNNING: "running",
} as const;

export type AutomationConversationDeliveryProcessorStatus =
  (typeof AutomationConversationDeliveryProcessorStatuses)[keyof typeof AutomationConversationDeliveryProcessorStatuses];

export const automationConversationDeliveryProcessors = controlPlaneSchema.table(
  "automation_conversation_delivery_processors",
  {
    conversationId: text("conversation_id")
      .primaryKey()
      .references(() => automationConversations.id, { onDelete: "cascade" }),
    generation: bigint("generation", { mode: "number" }).notNull().default(0),
    status: text("status")
      .notNull()
      .$type<AutomationConversationDeliveryProcessorStatus>()
      .default(AutomationConversationDeliveryProcessorStatuses.IDLE),
    activeWorkflowRunId: text("active_workflow_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
);

export type AutomationConversationDeliveryProcessor =
  typeof automationConversationDeliveryProcessors.$inferSelect;
export type InsertAutomationConversationDeliveryProcessor =
  typeof automationConversationDeliveryProcessors.$inferInsert;
