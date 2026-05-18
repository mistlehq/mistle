import { bigint, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";

import { controlPlaneSchema } from "./namespace.js";
import { triggerConversations } from "./trigger-conversations.js";

export const TriggerConversationDeliveryProcessorStatuses = {
  IDLE: "idle",
  RUNNING: "running",
} as const;

export type TriggerConversationDeliveryProcessorStatus =
  (typeof TriggerConversationDeliveryProcessorStatuses)[keyof typeof TriggerConversationDeliveryProcessorStatuses];

export function defineTriggerConversationDeliveryProcessors(schema: PgSchema) {
  return schema.table("trigger_conversation_delivery_processors", {
    conversationId: text("conversation_id")
      .primaryKey()
      .references(() => triggerConversations.id, { onDelete: "cascade" }),
    generation: bigint("generation", { mode: "number" }).notNull().default(0),
    status: text("status")
      .notNull()
      .$type<TriggerConversationDeliveryProcessorStatus>()
      .default(TriggerConversationDeliveryProcessorStatuses.IDLE),
    activeWorkflowRunId: text("active_workflow_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  });
}

export const triggerConversationDeliveryProcessors =
  defineTriggerConversationDeliveryProcessors(controlPlaneSchema);

export type TriggerConversationDeliveryProcessor =
  typeof triggerConversationDeliveryProcessors.$inferSelect;
export type InsertTriggerConversationDeliveryProcessor =
  typeof triggerConversationDeliveryProcessors.$inferInsert;
