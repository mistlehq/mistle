import { defineWorkflow } from "openworkflow";

import { executeConversationProviderDelivery } from "../../../control-plane-worker/src/runtime/automation-workflows/provider/execute-conversation-provider-delivery.js";
import { getWorkflowContext } from "../context.js";
import {
  acquireAutomationConnection,
  type AcquireAutomationConnectionDependencies,
  type EnsureAutomationSandboxDependencies,
  type PreparedAutomationRun,
  markAutomationRunCompleted,
  markAutomationRunFailed,
  markAutomationRunIgnored,
  prepareAutomationRun,
  resolveAutomationRunFailure,
} from "../shared/automation/index.js";
import {
  claimOrResumeAutomationConversationDeliveryTask,
  deliverConversationAutomationPayload,
  ensureConversationDeliverySandbox,
  resolveAutomationConversationDeliveryRoute,
} from "./conversation-delivery.js";
import { idleAutomationConversationDeliveryProcessorIfEmpty } from "./delivery-processor.js";
import {
  finalizeAutomationConversationDeliveryTask,
  resolveAutomationConversationDeliveryTaskAction,
} from "./delivery-tasks.js";
import { AutomationConversationDeliveryTaskActions } from "./types.js";
import type {
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput,
} from "./types.js";

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export const HandleAutomationConversationDeliveryWorkflow = defineWorkflow<
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput
>(
  {
    name: "control-plane.automation-conversations.handle-delivery",
    version: "1",
  },
  async ({ input, step }) => {
    const ctx = await getWorkflowContext();
    let iteration = 0;

    while (true) {
      const activeTask = await step.run(
        { name: `claim-or-resume-conversation-delivery-task:${String(iteration)}` },
        async () =>
          claimOrResumeAutomationConversationDeliveryTask(
            {
              db: ctx.db,
            },
            input,
          ),
      );

      if (activeTask === null) {
        const didIdleProcessor = await step.run(
          { name: `idle-conversation-delivery-processor-if-empty:${String(iteration)}` },
          async () =>
            idleAutomationConversationDeliveryProcessorIfEmpty(
              {
                db: ctx.db,
              },
              input,
            ),
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
          resolveAutomationConversationDeliveryTaskAction(
            {
              db: ctx.db,
            },
            {
              taskId: activeTask.taskId,
              generation: input.generation,
            },
          ),
      );

      if (taskAction === AutomationConversationDeliveryTaskActions.IGNORE) {
        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "mark-automation-run-ignored",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            markAutomationRunIgnored(
              {
                db: ctx.db,
              },
              {
                automationRunId: activeTask.automationRunId,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "finalize-conversation-delivery-task-ignored",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            finalizeAutomationConversationDeliveryTask(
              {
                db: ctx.db,
              },
              {
                taskId: activeTask.taskId,
                generation: input.generation,
                status: "ignored",
                failureCode: null,
                failureMessage: null,
              },
            ),
        );

        iteration += 1;
        continue;
      }

      try {
        const preparedAutomationRun: PreparedAutomationRun = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "prepare-automation-run",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            prepareAutomationRun(
              {
                db: ctx.db,
              },
              {
                automationRunId: activeTask.automationRunId,
              },
            ),
        );

        const resolvedAutomationConversationRoute = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "resolve-automation-conversation-delivery-route",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            resolveAutomationConversationDeliveryRoute(
              {
                db: ctx.db,
              },
              {
                conversationId: preparedAutomationRun.conversationId,
              },
            ),
        );

        const ensuredAutomationSandbox = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "ensure-automation-sandbox",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            ensureConversationDeliverySandbox(
              {
                db: ctx.db,
                getSandboxInstance: (
                  sandboxInput: Parameters<
                    AcquireAutomationConnectionDependencies["getSandboxInstance"]
                  >[0],
                ) => ctx.controlPlaneInternalClient.getSandboxInstance(sandboxInput),
                startSandboxProfileInstance: (
                  startInput: Parameters<
                    EnsureAutomationSandboxDependencies["startSandboxProfileInstance"]
                  >[0],
                ) => ctx.controlPlaneInternalClient.startSandboxProfileInstance(startInput),
              },
              {
                preparedAutomationRun,
                resolvedAutomationConversationRoute,
              },
            ),
        );

        const acquiredAutomationConnection = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "acquire-automation-connection",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            acquireAutomationConnection(
              {
                getSandboxInstance: (sandboxInput) =>
                  ctx.controlPlaneInternalClient.getSandboxInstance(sandboxInput),
                mintSandboxConnectionToken: (mintInput) =>
                  ctx.controlPlaneInternalClient.mintSandboxConnectionToken(mintInput),
              },
              {
                preparedAutomationRun,
                ensuredAutomationSandbox,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "deliver-automation-payload",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            deliverConversationAutomationPayload(
              {
                db: ctx.db,
                executeConversationProviderDelivery,
              },
              {
                taskId: activeTask.taskId,
                generation: input.generation,
                preparedAutomationRun,
                resolvedAutomationConversationRoute,
                ensuredAutomationSandbox,
                acquiredAutomationConnection,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "mark-automation-run-completed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            markAutomationRunCompleted(
              {
                db: ctx.db,
              },
              {
                automationRunId: activeTask.automationRunId,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "finalize-conversation-delivery-task-completed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            finalizeAutomationConversationDeliveryTask(
              {
                db: ctx.db,
              },
              {
                taskId: activeTask.taskId,
                generation: input.generation,
                status: "completed",
                failureCode: null,
                failureMessage: null,
              },
            ),
        );
      } catch (error) {
        const failure = resolveAutomationRunFailure(error);

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "mark-automation-run-failed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            markAutomationRunFailed(
              {
                db: ctx.db,
              },
              {
                automationRunId: activeTask.automationRunId,
                failureCode: failure.code,
                failureMessage: failure.message,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "finalize-conversation-delivery-task-failed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            finalizeAutomationConversationDeliveryTask(
              {
                db: ctx.db,
              },
              {
                taskId: activeTask.taskId,
                generation: input.generation,
                status: "failed",
                failureCode: failure.code,
                failureMessage: failure.message,
              },
            ),
        );
      }

      iteration += 1;
    }
  },
);
