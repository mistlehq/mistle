import {
  conversationDeliveryProcessors,
  ConversationDeliveryProcessorStatuses,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type EnsureConversationDeliveryProcessorInput = {
  conversationId: string;
  workflowRunId: string;
};

export type EnsureConversationDeliveryProcessorOutput = {
  conversationId: string;
  generation: number;
  shouldStart: boolean;
};

export async function ensureConversationDeliveryProcessor(
  deps: ConversationPersistenceDependencies,
  input: EnsureConversationDeliveryProcessorInput,
): Promise<EnsureConversationDeliveryProcessorOutput> {
  const insertedRows = await deps.db
    .insert(conversationDeliveryProcessors)
    .values({
      conversationId: input.conversationId,
      generation: 1,
      status: ConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: input.workflowRunId,
    })
    .onConflictDoNothing({
      target: [conversationDeliveryProcessors.conversationId],
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

  const updatedRows = await deps.db
    .update(conversationDeliveryProcessors)
    .set({
      generation: sql`${conversationDeliveryProcessors.generation} + 1`,
      status: ConversationDeliveryProcessorStatuses.RUNNING,
      activeWorkflowRunId: input.workflowRunId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(conversationDeliveryProcessors.conversationId, input.conversationId),
        eq(conversationDeliveryProcessors.status, ConversationDeliveryProcessorStatuses.IDLE),
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

  const existingProcessor = await deps.db.query.conversationDeliveryProcessors.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });
  if (existingProcessor === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_PROCESSOR_NOT_FOUND,
      message:
        "Conversation delivery processor row could not be loaded after insert or start-or-reuse attempt.",
    });
  }

  return {
    conversationId: existingProcessor.conversationId,
    generation: existingProcessor.generation,
    shouldStart: false,
  };
}
