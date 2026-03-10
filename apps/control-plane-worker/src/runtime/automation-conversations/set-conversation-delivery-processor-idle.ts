import {
  automationConversationDeliveryProcessors,
  AutomationConversationDeliveryProcessorStatuses,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type { AutomationConversationPersistenceDependencies } from "./types.js";

export type SetAutomationConversationDeliveryProcessorIdleInput = {
  conversationId: string;
  generation: number;
};

export async function setAutomationConversationDeliveryProcessorIdle(
  deps: AutomationConversationPersistenceDependencies,
  input: SetAutomationConversationDeliveryProcessorIdleInput,
): Promise<boolean> {
  const updatedRows = await deps.db
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
