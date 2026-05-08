import { HandleAutomationConversationDeliveryWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import type { PreparedAutomationRun } from "../shared/automation-run-types.js";
import { prepareAutomationRun, resolveAutomationRunFailure } from "../shared/automation-run.js";
import {
  markAutomationRunCompleted,
  markAutomationRunFailed,
  markAutomationRunIgnored,
} from "../shared/automation-run.js";
import { acquireAutomationConnection } from "./acquire-automation-connection.js";
import { claimOrResumeAutomationConversationDeliveryTask } from "./claim-or-resume-automation-conversation-delivery-task.js";
import { deliverConversationAutomationPayload } from "./deliver-conversation-automation-payload.js";
import { shouldRethrowDurableStepErrorForRetry } from "./durable-step-retry.js";
import { ensureConversationDeliverySandbox } from "./ensure-conversation-delivery-sandbox.js";
import { finalizeAutomationConversationDeliveryTask } from "./finalize-automation-conversation-delivery-task.js";
import { idleAutomationConversationDeliveryProcessorIfEmpty } from "./idle-automation-conversation-delivery-processor-if-empty.js";
import { resolveAutomationConversationDeliveryRoute } from "./resolve-automation-conversation-delivery-route.js";
import { resolveAutomationConversationDeliveryTaskAction } from "./resolve-automation-conversation-delivery-task-action.js";
import {
  logAutomationConversationDeliveryEvent,
  resolveAutomationConversationDeliveryTaskLifecycleEvent,
  withAutomationConversationDeliverySpan,
} from "./telemetry.js";

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export const HandleAutomationConversationDeliveryWorkflow = defineTracedControlPlaneWorkflow(
  HandleAutomationConversationDeliveryWorkflowSpec,
  async ({ input, run, step }) => {
    const { controlPlaneInternalClient, dataPlaneClient, db } = await getWorkflowContext();
    const workflowRunId = run.id;

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
            idleAutomationConversationDeliveryProcessorIfEmpty(
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

      const taskLifecycleEvent = resolveAutomationConversationDeliveryTaskLifecycleEvent({
        status: activeTask.status,
      });
      logAutomationConversationDeliveryEvent({
        eventName: taskLifecycleEvent.eventName,
        message: taskLifecycleEvent.message,
        telemetryContext: {
          automationRunId: activeTask.automationRunId,
          conversationId: input.conversationId,
          deliveryTaskId: activeTask.taskId,
          workflowRunId,
        },
        attributes: taskLifecycleEvent.attributes,
      });

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
            markAutomationRunIgnored(
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
            finalizeAutomationConversationDeliveryTask(
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

      let preparedAutomationRunForTelemetry: PreparedAutomationRun | null = null;

      try {
        const preparedAutomationRun = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "prepare-automation-run",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            prepareAutomationRun(
              {
                db,
              },
              {
                automationRunId: activeTask.automationRunId,
              },
            ),
        );
        preparedAutomationRunForTelemetry = preparedAutomationRun;

        const resolvedAutomationConversationRoute = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "resolve-automation-conversation-delivery-route",
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            withAutomationConversationDeliverySpan(
              {
                name: "automation_conversation_delivery.route.resolve",
                telemetryContext: {
                  automationRunId: activeTask.automationRunId,
                  conversationId: preparedAutomationRun.conversationId,
                  deliveryTaskId: activeTask.taskId,
                  webhookEventId: preparedAutomationRun.webhookEventId,
                  workflowRunId,
                },
              },
              async (span) => {
                const resolvedRoute = await resolveAutomationConversationDeliveryRoute(
                  {
                    db,
                  },
                  {
                    conversationId: preparedAutomationRun.conversationId,
                  },
                );

                span.setAttributes({
                  ...(resolvedRoute.routeId === null
                    ? {}
                    : { "mistle.route.id": resolvedRoute.routeId }),
                  ...(resolvedRoute.sandboxInstanceId === null
                    ? {}
                    : { "mistle.sandbox.instance_id": resolvedRoute.sandboxInstanceId }),
                  ...(resolvedRoute.providerConversationId === null
                    ? {}
                    : {
                        "mistle.provider.conversation_id": resolvedRoute.providerConversationId,
                      }),
                  ...(resolvedRoute.providerExecutionId === null
                    ? {}
                    : {
                        "mistle.provider.execution_id": resolvedRoute.providerExecutionId,
                      }),
                  "mistle.route.has_existing_route": resolvedRoute.routeId !== null,
                });

                return resolvedRoute;
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
                controlPlaneInternalClient,
              },
              {
                preparedAutomationRun,
                resolvedAutomationConversationRoute,
                deliveryTaskId: activeTask.taskId,
                workflowRunId,
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
                controlPlaneInternalClient,
                dataPlaneClient,
              },
              {
                preparedAutomationRun,
                ensuredAutomationSandbox,
                deliveryTaskId: activeTask.taskId,
                workflowRunId,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: "deliver-automation-payload",
              taskId: activeTask.taskId,
            }),
            retryPolicy: {
              maximumAttempts: 1,
            },
          },
          async () =>
            deliverConversationAutomationPayload(
              {
                controlPlaneInternalClient,
                db,
                dataPlaneClient,
              },
              {
                taskId: activeTask.taskId,
                generation: input.generation,
                preparedAutomationRun,
                resolvedAutomationConversationRoute,
                ensuredAutomationSandbox,
                acquiredAutomationConnection,
                workflowRunId,
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
            finalizeAutomationConversationDeliveryTask(
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

        logAutomationConversationDeliveryEvent({
          eventName: "delivery_task.completed",
          message: "Completed automation conversation delivery task",
          telemetryContext: {
            automationRunId: activeTask.automationRunId,
            conversationId:
              preparedAutomationRunForTelemetry?.conversationId ?? input.conversationId,
            deliveryTaskId: activeTask.taskId,
            webhookEventId: preparedAutomationRunForTelemetry?.webhookEventId,
            workflowRunId,
          },
        });
      } catch (error) {
        if (shouldRethrowDurableStepErrorForRetry(error)) {
          throw error;
        }

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
            finalizeAutomationConversationDeliveryTask(
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

        logAutomationConversationDeliveryEvent({
          eventName: "delivery_task.failed",
          message: "Failed automation conversation delivery task",
          telemetryContext: {
            automationRunId: activeTask.automationRunId,
            conversationId:
              preparedAutomationRunForTelemetry?.conversationId ?? input.conversationId,
            deliveryTaskId: activeTask.taskId,
            webhookEventId: preparedAutomationRunForTelemetry?.webhookEventId,
            workflowRunId,
          },
          attributes: {
            "mistle.delivery.failure_code": failure.code,
          },
          err: error,
          level: "error",
        });
      }

      iteration += 1;
    }
  },
);
