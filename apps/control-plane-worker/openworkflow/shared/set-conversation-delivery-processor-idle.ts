import {
  TriggerConversationDeliveryProcessorStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

export type SetTriggerConversationDeliveryProcessorIdleInput = {
  conversationId: string;
  generation: number;
};

export async function setTriggerConversationDeliveryProcessorIdle(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: SetTriggerConversationDeliveryProcessorIdleInput,
): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const updatedRows = await ctx.db
    .update(tables.triggerConversationDeliveryProcessors)
    .set({
      status: TriggerConversationDeliveryProcessorStatuses.IDLE,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.triggerConversationDeliveryProcessors.conversationId, input.conversationId),
        eq(tables.triggerConversationDeliveryProcessors.generation, input.generation),
        eq(
          tables.triggerConversationDeliveryProcessors.status,
          TriggerConversationDeliveryProcessorStatuses.RUNNING,
        ),
      ),
    )
    .returning({
      conversationId: tables.triggerConversationDeliveryProcessors.conversationId,
    });

  return updatedRows[0] !== undefined;
}
