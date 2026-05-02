import {
  AutomationConversationDeliveryProcessorStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
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
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const insertedRows = await ctx.db
    .insert(tables.automationConversationDeliveryProcessors)
    .values({
      conversationId: input.conversationId,
      generation: 1,
      status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
    })
    .onConflictDoNothing({
      target: [tables.automationConversationDeliveryProcessors.conversationId],
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
    .update(tables.automationConversationDeliveryProcessors)
    .set({
      generation: sql`${tables.automationConversationDeliveryProcessors.generation} + 1`,
      status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.automationConversationDeliveryProcessors.conversationId, input.conversationId),
        eq(
          tables.automationConversationDeliveryProcessors.status,
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
