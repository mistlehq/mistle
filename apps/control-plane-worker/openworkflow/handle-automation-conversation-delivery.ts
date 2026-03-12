import { HandleAutomationConversationDeliveryWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export const HandleAutomationConversationDeliveryWorkflow = defineWorkflow(
  HandleAutomationConversationDeliveryWorkflowSpec,
  async ({ input, step }) => {
    const {
      services: { automationConversationDelivery },
    } = await getWorkflowContext();

    let iteration = 0;

    while (true) {
      const activeTask = await step.run(
        { name: `claim-or-resume-conversation-delivery-task:${String(iteration)}` },
        async () =>
          automationConversationDelivery.claimOrResumeAutomationConversationDeliveryTask(input),
      );

      if (activeTask === null) {
        const didIdleProcessor = await step.run(
          { name: `idle-conversation-delivery-processor-if-empty:${String(iteration)}` },
          async () =>
            automationConversationDelivery.idleAutomationConversationDeliveryProcessorIfEmpty(
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
          automationConversationDelivery.resolveAutomationConversationDeliveryTaskAction({
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
            automationConversationDelivery.markAutomationRunIgnored({
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
            automationConversationDelivery.finalizeAutomationConversationDeliveryTask({
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
          async () =>
            automationConversationDelivery.prepareAutomationRun({
              automationRunId: activeTask.automationRunId,
            }),
        );

        const resolvedAutomationConversationRoute = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "resolve-automation-conversation-delivery-route",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            automationConversationDelivery.resolveAutomationConversationDeliveryRoute({
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
            automationConversationDelivery.ensureAutomationSandbox({
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
            automationConversationDelivery.acquireAutomationConnection({
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
            automationConversationDelivery.deliverAutomationPayload({
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
            automationConversationDelivery.markAutomationRunCompleted({
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
            automationConversationDelivery.finalizeAutomationConversationDeliveryTask({
              taskId: activeTask.taskId,
              generation: input.generation,
              status: "completed",
            }),
        );
      } catch (error) {
        const failure = automationConversationDelivery.resolveAutomationRunFailure({
          error,
        });

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "mark-automation-run-failed",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            automationConversationDelivery.markAutomationRunFailed({
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
            automationConversationDelivery.finalizeAutomationConversationDeliveryTask({
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
