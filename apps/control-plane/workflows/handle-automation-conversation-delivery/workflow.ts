import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { executeConversationProviderDelivery } from "../../src/worker/runtime/automation-workflows/provider/execute-conversation-provider-delivery.js";
import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";
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
} from "../runtime/index.js";

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

export type HandleAutomationConversationDeliveryWorkflowInput = {
  conversationId: string;
  generation: number;
};

export type HandleAutomationConversationDeliveryWorkflowOutput = {
  conversationId: string;
  generation: number;
};

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export const HandleAutomationConversationDeliveryWorkflow = defineWorkflow(
  defineWorkflowSpec<
    HandleAutomationConversationDeliveryWorkflowInput,
    HandleAutomationConversationDeliveryWorkflowOutput
  >({
    name: "control-plane.automations.handle-conversation-delivery",
    version: "1",
  }),
  async ({ input, step }) => {
    const runtime = await getControlPlaneWorkflowRuntime();
    let iteration = 0;

    while (true) {
      const activeTask = await step.run(
        { name: `claim-or-resume-conversation-delivery-task:${String(iteration)}` },
        async () =>
          claimOrResumeAutomationConversationDeliveryTask(
            {
              db: runtime.db,
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
                db: runtime.db,
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
              db: runtime.db,
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
                db: runtime.db,
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
                db: runtime.db,
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
                db: runtime.db,
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
                db: runtime.db,
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
                db: runtime.db,
                getSandboxInstance: (sandboxInput) =>
                  runtime.controlPlaneInternalClient.getSandboxInstance(sandboxInput),
                startSandboxProfileInstance: (startInput) =>
                  runtime.controlPlaneInternalClient.startSandboxProfileInstance(startInput),
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
                  runtime.controlPlaneInternalClient.getSandboxInstance(sandboxInput),
                mintSandboxConnectionToken: (mintInput) =>
                  runtime.controlPlaneInternalClient.mintSandboxConnectionToken(mintInput),
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
                db: runtime.db,
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
                db: runtime.db,
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
                db: runtime.db,
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
                db: runtime.db,
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
                db: runtime.db,
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

export const HandleAutomationConversationDeliveryWorkflowSpec =
  HandleAutomationConversationDeliveryWorkflow.spec;
