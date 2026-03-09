import { defineWorkflow, type Workflow } from "openworkflow";

import type { PreparedAutomationRun } from "../handle-automation-run/index.js";
import {
  HandleConversationDeliveryWorkflowSpec,
  type HandleConversationDeliveryWorkflowInput,
  type HandleConversationDeliveryWorkflowOutput,
} from "./spec.js";

export const ActiveConversationDeliveryTaskStatuses = {
  CLAIMED: "claimed",
  DELIVERING: "delivering",
} as const;

export type ActiveConversationDeliveryTaskStatus =
  (typeof ActiveConversationDeliveryTaskStatuses)[keyof typeof ActiveConversationDeliveryTaskStatuses];

export type ActiveConversationDeliveryTask = {
  taskId: string;
  automationRunId: string;
  status: ActiveConversationDeliveryTaskStatus;
};

export type EnsuredAutomationSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string;
};

export type AcquiredAutomationConnection = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type FinalConversationDeliveryTaskStatus = "completed" | "failed" | "ignored";
export type ConversationDeliveryTaskAction = "deliver" | "ignore";

export type CreateHandleConversationDeliveryWorkflowInput = {
  claimOrResumeConversationDeliveryTask: (
    input: HandleConversationDeliveryWorkflowInput,
  ) => Promise<ActiveConversationDeliveryTask | null>;
  resolveConversationDeliveryTaskAction: (input: {
    taskId: string;
    generation: number;
  }) => Promise<ConversationDeliveryTaskAction>;
  idleConversationDeliveryProcessorIfEmpty: (
    input: HandleConversationDeliveryWorkflowInput,
  ) => Promise<boolean>;
  prepareAutomationRun: (input: { automationRunId: string }) => Promise<PreparedAutomationRun>;
  ensureAutomationSandbox: (input: {
    preparedAutomationRun: PreparedAutomationRun;
  }) => Promise<EnsuredAutomationSandbox>;
  acquireAutomationConnection: (input: {
    preparedAutomationRun: PreparedAutomationRun;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
  }) => Promise<AcquiredAutomationConnection>;
  deliverAutomationPayload: (input: {
    taskId: string;
    generation: number;
    preparedAutomationRun: PreparedAutomationRun;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
    acquiredAutomationConnection: AcquiredAutomationConnection;
  }) => Promise<void>;
  markAutomationRunCompleted: (input: { automationRunId: string }) => Promise<void>;
  markAutomationRunIgnored: (input: { automationRunId: string }) => Promise<void>;
  markAutomationRunFailed: (input: {
    automationRunId: string;
    failureCode: string;
    failureMessage: string;
  }) => Promise<void>;
  finalizeConversationDeliveryTask: (input: {
    taskId: string;
    generation: number;
    status: FinalConversationDeliveryTaskStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  }) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => { code: string; message: string };
};

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export function createHandleConversationDeliveryWorkflow(
  ctx: CreateHandleConversationDeliveryWorkflowInput,
): Workflow<
  HandleConversationDeliveryWorkflowInput,
  HandleConversationDeliveryWorkflowOutput,
  HandleConversationDeliveryWorkflowInput
> {
  return defineWorkflow(HandleConversationDeliveryWorkflowSpec, async ({ input, step }) => {
    let iteration = 0;

    while (true) {
      const activeTask = await step.run(
        { name: `claim-or-resume-conversation-delivery-task:${String(iteration)}` },
        async () => ctx.claimOrResumeConversationDeliveryTask(input),
      );

      if (activeTask === null) {
        const didIdleProcessor = await step.run(
          { name: `idle-conversation-delivery-processor-if-empty:${String(iteration)}` },
          async () => ctx.idleConversationDeliveryProcessorIfEmpty(input),
        );
        if (didIdleProcessor) {
          return {
            conversationId: input.conversationId,
            generation: input.generation,
          };
        }

        iteration += 1;
        continue;
      }

      const taskAction = await step.run(
        {
          name: getConversationDeliveryStepName({
            prefix: "resolve-conversation-delivery-task-action",
            taskId: activeTask.taskId,
          }),
        },
        async () =>
          ctx.resolveConversationDeliveryTaskAction({
            taskId: activeTask.taskId,
            generation: input.generation,
          }),
      );

      if (taskAction === "ignore") {
        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "mark-automation-run-ignored",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.markAutomationRunIgnored({
              automationRunId: activeTask.automationRunId,
            }),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "finalize-conversation-delivery-task-ignored",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.finalizeConversationDeliveryTask({
              taskId: activeTask.taskId,
              generation: input.generation,
              status: "ignored",
            }),
        );

        iteration += 1;
        continue;
      }

      try {
        const preparedAutomationRun = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "prepare-automation-run",
              taskId: activeTask.taskId,
            }),
          },
          async () => ctx.prepareAutomationRun({ automationRunId: activeTask.automationRunId }),
        );

        const ensuredAutomationSandbox = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "ensure-automation-sandbox",
              taskId: activeTask.taskId,
            }),
          },
          async () => ctx.ensureAutomationSandbox({ preparedAutomationRun }),
        );

        const acquiredAutomationConnection = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "acquire-automation-connection",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.acquireAutomationConnection({
              preparedAutomationRun,
              ensuredAutomationSandbox,
            }),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "deliver-automation-payload",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.deliverAutomationPayload({
              taskId: activeTask.taskId,
              generation: input.generation,
              preparedAutomationRun,
              ensuredAutomationSandbox,
              acquiredAutomationConnection,
            }),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "mark-automation-run-completed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.markAutomationRunCompleted({
              automationRunId: activeTask.automationRunId,
            }),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "finalize-conversation-delivery-task-completed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.finalizeConversationDeliveryTask({
              taskId: activeTask.taskId,
              generation: input.generation,
              status: "completed",
            }),
        );
      } catch (error) {
        const failure = ctx.resolveAutomationRunFailure({ error });

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "mark-automation-run-failed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.markAutomationRunFailed({
              automationRunId: activeTask.automationRunId,
              failureCode: failure.code,
              failureMessage: failure.message,
            }),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "finalize-conversation-delivery-task-failed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ctx.finalizeConversationDeliveryTask({
              taskId: activeTask.taskId,
              generation: input.generation,
              status: "failed",
              failureCode: failure.code,
              failureMessage: failure.message,
            }),
        );
      }

      iteration += 1;
    }
  });
}
