import {
  automationConversationDeliveryProcessors,
  AutomationConversationDeliveryProcessorStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./automation-conversation-persistence-error.js";
export type EnsureAutomationConversationDeliveryProcessorInput = {
  conversationId: string;
};

export type EnsureAutomationConversationDeliveryProcessorOutput = {
  conversationId: string;
  generation: number;
  shouldStart: boolean;
};

export async function ensureAutomationConversationDeliveryProcessor(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: EnsureAutomationConversationDeliveryProcessorInput,
): Promise<EnsureAutomationConversationDeliveryProcessorOutput> {
  const insertedRows = await ctx.db
    .insert(automationConversationDeliveryProcessors)
    .values({
      conversationId: input.conversationId,
      generation: 1,
      status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
    })
    .onConflictDoNothing({
      target: [automationConversationDeliveryProcessors.conversationId],
    })
    .returning();
  const insertedProcessor = insertedRows[0];
  if (insertedProcessor !== undefined) {
    return {
      conversationId: insertedProcessor.conversationId,
      generation: insertedProcessor.generation,
      shouldStart: true,
    };
  }

  const updatedRows = await ctx.db
    .update(automationConversationDeliveryProcessors)
    .set({
      generation: sql`${automationConversationDeliveryProcessors.generation} + 1`,
      status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationConversationDeliveryProcessors.conversationId, input.conversationId),
        eq(
          automationConversationDeliveryProcessors.status,
          AutomationConversationDeliveryProcessorStatuses.IDLE,
        ),
      ),
    )
    .returning();
  const updatedProcessor = updatedRows[0];
  if (updatedProcessor !== undefined) {
    return {
      conversationId: updatedProcessor.conversationId,
      generation: updatedProcessor.generation,
      shouldStart: true,
    };
  }

  const existingProcessor = await ctx.db.query.automationConversationDeliveryProcessors.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });
  if (existingProcessor === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_PROCESSOR_NOT_FOUND,
      message:
        "AutomationConversation delivery processor row could not be loaded after insert or start-or-reuse attempt.",
    });
  }

  return {
    conversationId: existingProcessor.conversationId,
    generation: existingProcessor.generation,
    shouldStart: false,
  };
}
