import { HandleAutomationConversationDeliveryWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";
import { executeConversationProviderDelivery } from "../src/runtime/automation-workflows/provider/execute-conversation-provider-delivery.js";
import {
  acquireConversationDeliveryConnection,
  claimOrResumeAutomationConversationDeliveryTask,
  completeConversationDeliveryAutomationRun,
  deliverConversationAutomationPayload,
  ensureConversationDeliverySandbox,
  failConversationDeliveryAutomationRun,
  finalizeAutomationConversationDeliveryActiveTask,
  idleAutomationConversationDeliveryProcessor,
  ignoreAutomationConversationDeliveryAutomationRun,
  prepareConversationDeliveryAutomationRun,
  resolveAutomationConversationDeliveryActiveTaskAction,
  resolveAutomationConversationDeliveryRoute,
  resolveAutomationRunFailure,
} from "../src/runtime/workflows/index.js";

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export const HandleAutomationConversationDeliveryWorkflow = defineWorkflow(
  HandleAutomationConversationDeliveryWorkflowSpec,
  async ({ input, step }) => {
    const { controlPlaneInternalClient, db } = await getWorkflowContext();

    let iteration = 0;

    while (true) {
      const activeTask = await step.run(
        { name: `claim-or-resume-conversation-delivery-task:${String(iteration)}` },
        async () =>
          claimOrResumeAutomationConversationDeliveryTask(
            {
              db,
            },
            input,
          ),
      );

      if (activeTask === null) {
        const didIdleProcessor = await step.run(
          { name: `idle-conversation-delivery-processor-if-empty:${String(iteration)}` },
          async () =>
            idleAutomationConversationDeliveryProcessor(
              {
                db,
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
          resolveAutomationConversationDeliveryActiveTaskAction(
            {
              db,
            },
            {
              taskId: activeTask.taskId,
              generation: input.generation,
            },
          ),
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
            ignoreAutomationConversationDeliveryAutomationRun(
              {
                db,
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
            finalizeAutomationConversationDeliveryActiveTask(
              {
                db,
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
        const preparedAutomationRun = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "prepare-automation-run",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            prepareConversationDeliveryAutomationRun(
              {
                db,
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
                db,
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
                db,
                getSandboxInstance: (sandboxInput) =>
                  controlPlaneInternalClient.getSandboxInstance(sandboxInput),
                startSandboxProfileInstance: (startInput) =>
                  controlPlaneInternalClient.startSandboxProfileInstance(startInput),
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
            acquireConversationDeliveryConnection(
              {
                getSandboxInstance: (sandboxInput) =>
                  controlPlaneInternalClient.getSandboxInstance(sandboxInput),
                mintSandboxConnectionToken: (mintInput) =>
                  controlPlaneInternalClient.mintSandboxConnectionToken(mintInput),
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
                db,
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
            completeConversationDeliveryAutomationRun(
              {
                db,
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
            finalizeAutomationConversationDeliveryActiveTask(
              {
                db,
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
            failConversationDeliveryAutomationRun(
              {
                db,
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
            finalizeAutomationConversationDeliveryActiveTask(
              {
                db,
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
