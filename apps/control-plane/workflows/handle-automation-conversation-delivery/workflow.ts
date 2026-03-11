import { defineWorkflow, type Workflow } from "openworkflow";

import type { PreparedAutomationRun } from "../handle-automation-run/index.js";
import {
  HandleAutomationConversationDeliveryWorkflowSpec,
  type HandleAutomationConversationDeliveryWorkflowInput,
  type HandleAutomationConversationDeliveryWorkflowOutput,
} from "./spec.js";

export const ActiveAutomationConversationDeliveryTaskStatuses = {
  CLAIMED: "claimed",
  DELIVERING: "delivering",
} as const;

export type ActiveAutomationConversationDeliveryTaskStatus =
  (typeof ActiveAutomationConversationDeliveryTaskStatuses)[keyof typeof ActiveAutomationConversationDeliveryTaskStatuses];

export type ActiveAutomationConversationDeliveryTask = {
  taskId: string;
  automationRunId: string;
  status: ActiveAutomationConversationDeliveryTaskStatus;
};

export type EnsuredAutomationSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string | null;
};

export type ResolvedAutomationConversationDeliveryRoute = {
  conversationId: string;
  integrationFamilyId: string;
  routeId: string | null;
  sandboxInstanceId: string | null;
  providerConversationId: string | null;
  providerExecutionId: string | null;
  providerState: unknown;
};

export type AcquiredAutomationConnection = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type FinalAutomationConversationDeliveryTaskStatus = "completed" | "failed" | "ignored";
export type AutomationConversationDeliveryTaskAction = "deliver" | "ignore";

export type CreateHandleAutomationConversationDeliveryWorkflowInput = {
  claimOrResumeAutomationConversationDeliveryTask: (
    input: HandleAutomationConversationDeliveryWorkflowInput,
  ) => Promise<ActiveAutomationConversationDeliveryTask | null>;
  resolveAutomationConversationDeliveryTaskAction: (input: {
    taskId: string;
    generation: number;
  }) => Promise<AutomationConversationDeliveryTaskAction>;
  idleAutomationConversationDeliveryProcessorIfEmpty: (
    input: HandleAutomationConversationDeliveryWorkflowInput,
  ) => Promise<boolean>;
  prepareAutomationRun: (input: { automationRunId: string }) => Promise<PreparedAutomationRun>;
  resolveAutomationConversationDeliveryRoute: (input: {
    conversationId: string;
  }) => Promise<ResolvedAutomationConversationDeliveryRoute>;
  ensureAutomationSandbox: (input: {
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  }) => Promise<EnsuredAutomationSandbox>;
  acquireAutomationConnection: (input: {
    preparedAutomationRun: PreparedAutomationRun;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
  }) => Promise<AcquiredAutomationConnection>;
  deliverAutomationPayload: (input: {
    taskId: string;
    generation: number;
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
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
  finalizeAutomationConversationDeliveryTask: (input: {
    taskId: string;
    generation: number;
    status: FinalAutomationConversationDeliveryTaskStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  }) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => { code: string; message: string };
};

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export function createHandleAutomationConversationDeliveryWorkflow(
  ctx: CreateHandleAutomationConversationDeliveryWorkflowInput,
): Workflow<
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput,
  HandleAutomationConversationDeliveryWorkflowInput
> {
  return defineWorkflow(
    HandleAutomationConversationDeliveryWorkflowSpec,
    async ({ input, step }) => {
      let iteration = 0;

      while (true) {
        const activeTask = await step.run(
          { name: `claim-or-resume-conversation-delivery-task:${String(iteration)}` },
          async () => ctx.claimOrResumeAutomationConversationDeliveryTask(input),
        );

        if (activeTask === null) {
          const didIdleProcessor = await step.run(
            { name: `idle-conversation-delivery-processor-if-empty:${String(iteration)}` },
            async () => ctx.idleAutomationConversationDeliveryProcessorIfEmpty(input),
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
            ctx.resolveAutomationConversationDeliveryTaskAction({
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
              ctx.finalizeAutomationConversationDeliveryTask({
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

          const resolvedAutomationConversationRoute = await step.run(
            {
              name: getConversationDeliveryStepName({
                prefix: "resolve-automation-conversation-delivery-route",
                taskId: activeTask.taskId,
              }),
            },
            async () =>
              ctx.resolveAutomationConversationDeliveryRoute({
                conversationId: preparedAutomationRun.conversationId,
              }),
          );

          const ensuredAutomationSandbox = await step.run(
            {
              name: getConversationDeliveryStepName({
                prefix: "ensure-automation-sandbox",
                taskId: activeTask.taskId,
              }),
            },
            async () =>
              ctx.ensureAutomationSandbox({
                preparedAutomationRun,
                resolvedAutomationConversationRoute,
              }),
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
                resolvedAutomationConversationRoute,
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
              ctx.finalizeAutomationConversationDeliveryTask({
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
              ctx.finalizeAutomationConversationDeliveryTask({
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
    },
  );
}
