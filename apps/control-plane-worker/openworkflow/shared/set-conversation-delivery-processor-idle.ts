import {
  AutomationConversationDeliveryProcessorStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

export type SetAutomationConversationDeliveryProcessorIdleInput = {
  conversationId: string;
  generation: number;
};

export async function setAutomationConversationDeliveryProcessorIdle(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: SetAutomationConversationDeliveryProcessorIdleInput,
): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const updatedRows = await ctx.db
    .update(tables.automationConversationDeliveryProcessors)
    .set({
      status: AutomationConversationDeliveryProcessorStatuses.IDLE,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.automationConversationDeliveryProcessors.conversationId, input.conversationId),
        eq(tables.automationConversationDeliveryProcessors.generation, input.generation),
        eq(
          tables.automationConversationDeliveryProcessors.status,
          AutomationConversationDeliveryProcessorStatuses.RUNNING,
        ),
      ),
    )
    .returning({
      conversationId: tables.automationConversationDeliveryProcessors.conversationId,
    });

  return updatedRows[0] !== undefined;
}
