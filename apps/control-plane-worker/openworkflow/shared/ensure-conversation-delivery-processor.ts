import {
  TriggerConversationDeliveryProcessorStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "./trigger-conversation-persistence-error.js";
export type EnsureTriggerConversationDeliveryProcessorInput = {
  conversationId: string;
};

export type EnsureTriggerConversationDeliveryProcessorOutput = {
  conversationId: string;
  generation: number;
  shouldStart: boolean;
};

export async function ensureTriggerConversationDeliveryProcessor(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: EnsureTriggerConversationDeliveryProcessorInput,
): Promise<EnsureTriggerConversationDeliveryProcessorOutput> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const insertedRows = await ctx.db
    .insert(tables.triggerConversationDeliveryProcessors)
    .values({
      conversationId: input.conversationId,
      generation: 1,
      status: TriggerConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
    })
    .onConflictDoNothing({
      target: [tables.triggerConversationDeliveryProcessors.conversationId],
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
    .update(tables.triggerConversationDeliveryProcessors)
    .set({
      generation: sql`${tables.triggerConversationDeliveryProcessors.generation} + 1`,
      status: TriggerConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.triggerConversationDeliveryProcessors.conversationId, input.conversationId),
        eq(
          tables.triggerConversationDeliveryProcessors.status,
          TriggerConversationDeliveryProcessorStatuses.IDLE,
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

  const existingProcessor = await ctx.db.query.triggerConversationDeliveryProcessors.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });
  if (existingProcessor === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_PROCESSOR_NOT_FOUND,
      message:
        "TriggerConversation delivery processor row could not be loaded after insert or start-or-reuse attempt.",
    });
  }

  return {
    conversationId: existingProcessor.conversationId,
    generation: existingProcessor.generation,
    shouldStart: false,
  };
}
