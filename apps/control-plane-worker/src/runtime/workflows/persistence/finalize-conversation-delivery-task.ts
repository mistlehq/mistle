import {
  automationConversations,
  automationConversationDeliveryTasks,
  AutomationConversationDeliveryTaskStatuses,
  type AutomationConversationDeliveryTaskStatus,
} from "@mistle/db/control-plane";
import { and, eq, or, sql } from "drizzle-orm";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./errors.js";
import type { AutomationConversationPersistenceDependencies } from "./types.js";

const FinalAutomationConversationDeliveryTaskStatuses =
  new Set<AutomationConversationDeliveryTaskStatus>([
    AutomationConversationDeliveryTaskStatuses.COMPLETED,
    AutomationConversationDeliveryTaskStatuses.FAILED,
    AutomationConversationDeliveryTaskStatuses.IGNORED,
  ]);

export type FinalizeAutomationConversationDeliveryTaskInput = {
  taskId: string;
  generation: number;
  status: AutomationConversationDeliveryTaskStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
};

export async function finalizeAutomationConversationDeliveryTask(
  ctx: AutomationConversationPersistenceDependencies,
  input: FinalizeAutomationConversationDeliveryTaskInput,
) {
  if (!FinalAutomationConversationDeliveryTaskStatuses.has(input.status)) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH,
      message: `AutomationConversation delivery task status '${input.status}' is not terminal.`,
    });
  }

  return ctx.db.transaction(async (tx) => {
    const updatedRows = await tx
      .update(automationConversationDeliveryTasks)
      .set({
        status: input.status,
        failureCode: input.failureCode ?? null,
        failureMessage: input.failureMessage ?? null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(automationConversationDeliveryTasks.id, input.taskId),
          eq(automationConversationDeliveryTasks.processorGeneration, input.generation),
          or(
            eq(
              automationConversationDeliveryTasks.status,
              AutomationConversationDeliveryTaskStatuses.CLAIMED,
            ),
            eq(
              automationConversationDeliveryTasks.status,
              AutomationConversationDeliveryTaskStatuses.DELIVERING,
            ),
          ),
        ),
      )
      .returning();
    const updatedTask = updatedRows[0];
    if (updatedTask !== undefined) {
      if (input.status === AutomationConversationDeliveryTaskStatuses.COMPLETED) {
        await tx
          .update(automationConversations)
          .set({
            lastProcessedSourceOrderKey: updatedTask.sourceOrderKey,
            lastProcessedWebhookEventId: updatedTask.sourceWebhookEventId,
            updatedAt: sql`now()`,
            lastActivityAt: sql`now()`,
          })
          .where(eq(automationConversations.id, updatedTask.conversationId));
      }

      return updatedTask;
    }

    const existingTask = await tx.query.automationConversationDeliveryTasks.findFirst({
      where: (table, { eq }) => eq(table.id, input.taskId),
    });
    if (existingTask === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
        message: `AutomationConversation delivery task '${input.taskId}' was not found.`,
      });
    }

    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${input.taskId}' is not active for generation '${input.generation}'.`,
    });
  });
}
