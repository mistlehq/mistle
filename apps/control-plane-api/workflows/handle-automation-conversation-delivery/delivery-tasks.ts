import type { AutomationConversationDeliveryTaskStatus } from "@mistle/db/control-plane";
import {
  automationConversationDeliveryTasks,
  automationConversations,
  AutomationConversationDeliveryTaskStatuses,
} from "@mistle/db/control-plane";
import { and, eq, or, sql } from "drizzle-orm";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./error.js";
import { AutomationConversationDeliveryTaskActions } from "./types.js";
import type {
  ActiveConversationDeliveryTask,
  AutomationConversationDeliveryTaskAction,
  AutomationConversationPersistenceDependencies,
} from "./types.js";

function assertTaskIsActiveForGeneration(input: {
  task: ActiveConversationDeliveryTask;
  generation: number;
}) {
  if (input.task.processorGeneration !== input.generation) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }

  if (
    input.task.status !== AutomationConversationDeliveryTaskStatuses.CLAIMED &&
    input.task.status !== AutomationConversationDeliveryTaskStatuses.DELIVERING
  ) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${input.task.id}' is not active for generation '${input.generation}'.`,
    });
  }
}

export async function resolveAutomationConversationDeliveryTaskAction(
  ctx: AutomationConversationPersistenceDependencies,
  input: {
    taskId: string;
    generation: number;
  },
): Promise<AutomationConversationDeliveryTaskAction> {
  const task = await ctx.db.query.automationConversationDeliveryTasks.findFirst({
    columns: {
      id: true,
      conversationId: true,
      processorGeneration: true,
      sourceOrderKey: true,
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, input.taskId),
  });
  if (task === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `AutomationConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  assertTaskIsActiveForGeneration({
    task,
    generation: input.generation,
  });

  const conversation = await ctx.db.query.automationConversations.findFirst({
    columns: {
      id: true,
      lastProcessedSourceOrderKey: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, task.conversationId),
  });
  if (conversation === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `AutomationConversation '${task.conversationId}' was not found for task '${task.id}'.`,
    });
  }

  if (
    conversation.lastProcessedSourceOrderKey !== null &&
    task.sourceOrderKey <= conversation.lastProcessedSourceOrderKey
  ) {
    return AutomationConversationDeliveryTaskActions.IGNORE;
  }

  return AutomationConversationDeliveryTaskActions.DELIVER;
}

export async function claimNextAutomationConversationDeliveryTask(
  ctx: AutomationConversationPersistenceDependencies,
  input: {
    conversationId: string;
    generation: number;
  },
) {
  return ctx.db.transaction(async (tx) => {
    const nextTask = await tx.query.automationConversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, AutomationConversationDeliveryTaskStatuses.QUEUED),
        ),
      orderBy: (table, { asc: orderAsc }) => [
        orderAsc(table.sourceOrderKey),
        orderAsc(table.createdAt),
        orderAsc(table.id),
      ],
    });
    if (nextTask === undefined) {
      return null;
    }

    const updatedRows = await tx
      .update(automationConversationDeliveryTasks)
      .set({
        status: AutomationConversationDeliveryTaskStatuses.CLAIMED,
        processorGeneration: input.generation,
        attemptCount: sql`${automationConversationDeliveryTasks.attemptCount} + 1`,
        claimedAt: sql`now()`,
        deliveryStartedAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(automationConversationDeliveryTasks.id, nextTask.id),
          eq(
            automationConversationDeliveryTasks.status,
            AutomationConversationDeliveryTaskStatuses.QUEUED,
          ),
        ),
      )
      .returning();

    return updatedRows[0] ?? null;
  });
}

export async function findActiveAutomationConversationDeliveryTask(
  ctx: AutomationConversationPersistenceDependencies,
  input: {
    conversationId: string;
    generation: number;
  },
) {
  return ctx.db.query.automationConversationDeliveryTasks.findFirst({
    where: (table, { and: whereAnd, eq: whereEq, or: whereOr }) =>
      whereAnd(
        whereEq(table.conversationId, input.conversationId),
        whereEq(table.processorGeneration, input.generation),
        whereOr(
          whereEq(table.status, AutomationConversationDeliveryTaskStatuses.CLAIMED),
          whereEq(table.status, AutomationConversationDeliveryTaskStatuses.DELIVERING),
        ),
      ),
    orderBy: (table, { asc: orderAsc }) => [
      orderAsc(table.claimedAt),
      orderAsc(table.deliveryStartedAt),
      orderAsc(table.createdAt),
      orderAsc(table.id),
    ],
  });
}

export async function markAutomationConversationDeliveryTaskDelivering(
  deps: AutomationConversationPersistenceDependencies,
  input: {
    taskId: string;
    generation: number;
  },
) {
  const updatedRows = await deps.db
    .update(automationConversationDeliveryTasks)
    .set({
      status: AutomationConversationDeliveryTaskStatuses.DELIVERING,
      deliveryStartedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationConversationDeliveryTasks.id, input.taskId),
        eq(automationConversationDeliveryTasks.processorGeneration, input.generation),
        eq(
          automationConversationDeliveryTasks.status,
          AutomationConversationDeliveryTaskStatuses.CLAIMED,
        ),
      ),
    )
    .returning();
  const updatedTask = updatedRows[0];
  if (updatedTask !== undefined) {
    return updatedTask;
  }

  const existingTask = await deps.db.query.automationConversationDeliveryTasks.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.taskId),
  });
  if (existingTask === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `AutomationConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  throw new AutomationConversationPersistenceError({
    code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
    message: `AutomationConversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
  });
}

const FinalAutomationConversationDeliveryTaskStatuses =
  new Set<AutomationConversationDeliveryTaskStatus>([
    AutomationConversationDeliveryTaskStatuses.COMPLETED,
    AutomationConversationDeliveryTaskStatuses.FAILED,
    AutomationConversationDeliveryTaskStatuses.IGNORED,
  ]);

export async function finalizeAutomationConversationDeliveryTask(
  ctx: AutomationConversationPersistenceDependencies,
  input: {
    taskId: string;
    generation: number;
    status: AutomationConversationDeliveryTaskStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  },
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
      where: (table, { eq: whereEq }) => whereEq(table.id, input.taskId),
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
