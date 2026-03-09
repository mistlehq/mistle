import {
  conversationDeliveryProcessors,
  ConversationDeliveryProcessorStatuses,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type { ConversationPersistenceDependencies } from "./types.js";

export type SetConversationDeliveryProcessorIdleInput = {
  conversationId: string;
  generation: number;
};

export async function setConversationDeliveryProcessorIdle(
  deps: ConversationPersistenceDependencies,
  input: SetConversationDeliveryProcessorIdleInput,
): Promise<boolean> {
  const updatedRows = await deps.db
    .update(conversationDeliveryProcessors)
    .set({
      status: ConversationDeliveryProcessorStatuses.IDLE,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(conversationDeliveryProcessors.conversationId, input.conversationId),
        eq(conversationDeliveryProcessors.generation, input.generation),
        eq(conversationDeliveryProcessors.status, ConversationDeliveryProcessorStatuses.RUNNING),
      ),
    )
    .returning({
      conversationId: conversationDeliveryProcessors.conversationId,
    });

  return updatedRows[0] !== undefined;
}
