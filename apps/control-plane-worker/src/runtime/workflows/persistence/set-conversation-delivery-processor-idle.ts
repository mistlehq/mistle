import {
  automationConversationDeliveryProcessors,
  AutomationConversationDeliveryProcessorStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
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
  const updatedRows = await ctx.db
    .update(automationConversationDeliveryProcessors)
    .set({
      status: AutomationConversationDeliveryProcessorStatuses.IDLE,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationConversationDeliveryProcessors.conversationId, input.conversationId),
        eq(automationConversationDeliveryProcessors.generation, input.generation),
        eq(
          automationConversationDeliveryProcessors.status,
          AutomationConversationDeliveryProcessorStatuses.RUNNING,
        ),
      ),
    )
    .returning({
      conversationId: automationConversationDeliveryProcessors.conversationId,
    });

  return updatedRows[0] !== undefined;
}
