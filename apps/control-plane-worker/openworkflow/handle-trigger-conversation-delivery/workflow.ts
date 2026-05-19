import { HandleTriggerConversationDeliveryWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { shouldRethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import type { PreparedTriggerRun } from "../shared/trigger-run-types.js";
import {
  isPermanentTriggerRunExecutionFailure,
  markTriggerRunCompleted,
  markTriggerRunFailed,
  markTriggerRunIgnored,
  prepareTriggerRun,
  resolveTriggerRunFailure,
} from "../shared/trigger-run.js";
import { acquireTriggerConnection } from "./acquire-trigger-connection.js";
import { claimOrResumeTriggerConversationDeliveryTask } from "./claim-or-resume-trigger-conversation-delivery-task.js";
import { deliverConversationTriggerPayload } from "./deliver-conversation-trigger-payload.js";
import { ensureConversationDeliverySandbox } from "./ensure-conversation-delivery-sandbox.js";
import { finalizeTriggerConversationDeliveryTask } from "./finalize-trigger-conversation-delivery-task.js";
import { idleTriggerConversationDeliveryProcessorIfEmpty } from "./idle-trigger-conversation-delivery-processor-if-empty.js";
import { resolveTriggerConversationDeliveryRoute } from "./resolve-trigger-conversation-delivery-route.js";
import { resolveTriggerConversationDeliveryTaskAction } from "./resolve-trigger-conversation-delivery-task-action.js";
import {
  logTriggerConversationDeliveryEvent,
  resolveTriggerConversationDeliveryTaskLifecycleEvent,
  withTriggerConversationDeliverySpan,
} from "./telemetry.js";

function getConversationDeliveryStepName(input: { prefix: string; taskId: string }) {
  return `${input.prefix}:${input.taskId}`;
}

export const DurableTriggerConversationDeliveryStepPrefixes = {
  MARK_RUN_IGNORED: "mark-automation-run-ignored",
  PREPARE_RUN: "prepare-automation-run",
  RESOLVE_ROUTE: "resolve-automation-conversation-delivery-route",
  ENSURE_SANDBOX: "ensure-automation-sandbox",
  ACQUIRE_CONNECTION: "acquire-automation-connection",
  DELIVER_PAYLOAD: "deliver-automation-payload",
  MARK_RUN_COMPLETED: "mark-automation-run-completed",
  MARK_RUN_FAILED: "mark-automation-run-failed",
} as const;

export const HandleTriggerConversationDeliveryWorkflow = defineTracedControlPlaneWorkflow(
  HandleTriggerConversationDeliveryWorkflowSpec,
  async ({ input, run, step }) => {
    const { controlPlaneInternalClient, dataPlaneClient, db } = await getWorkflowContext();
    const workflowRunId = run.id;

    let iteration = 0;

    while (true) {
      const activeTask = await step.run(
        { name: `claim-or-resume-conversation-delivery-task:${String(iteration)}` },
        async () =>
          claimOrResumeTriggerConversationDeliveryTask(
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
            idleTriggerConversationDeliveryProcessorIfEmpty(
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

      const taskLifecycleEvent = resolveTriggerConversationDeliveryTaskLifecycleEvent({
        status: activeTask.status,
      });
      logTriggerConversationDeliveryEvent({
        eventName: taskLifecycleEvent.eventName,
        message: taskLifecycleEvent.message,
        telemetryContext: {
          triggerRunId: activeTask.triggerRunId,
          conversationId: input.conversationId,
          deliveryTaskId: activeTask.taskId,
          attemptCount: activeTask.attemptCount,
          processorGeneration: activeTask.processorGeneration,
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
          resolveTriggerConversationDeliveryTaskAction(
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
              prefix: DurableTriggerConversationDeliveryStepPrefixes.MARK_RUN_IGNORED,
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            markTriggerRunIgnored(
              {
                db,
              },
              {
                triggerRunId: activeTask.triggerRunId,
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
            finalizeTriggerConversationDeliveryTask(
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

      let preparedTriggerRunForTelemetry: PreparedTriggerRun | null = null;

      try {
        const preparedTriggerRun = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.PREPARE_RUN,
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            prepareTriggerRun(
              {
                db,
              },
              {
                triggerRunId: activeTask.triggerRunId,
              },
            ),
        );
        preparedTriggerRunForTelemetry = preparedTriggerRun;

        const resolvedTriggerConversationRoute = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.RESOLVE_ROUTE,
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            withTriggerConversationDeliverySpan(
              {
                name: "trigger_conversation_delivery.route.resolve",
                telemetryContext: {
                  triggerRunId: activeTask.triggerRunId,
                  conversationId: preparedTriggerRun.conversationId,
                  deliveryTaskId: activeTask.taskId,
                  attemptCount: activeTask.attemptCount,
                  processorGeneration: activeTask.processorGeneration,
                  webhookEventId: preparedTriggerRun.webhookEventId,
                  workflowRunId,
                },
              },
              async (span) => {
                const resolvedRoute = await resolveTriggerConversationDeliveryRoute(
                  {
                    db,
                  },
                  {
                    conversationId: preparedTriggerRun.conversationId,
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

        const ensuredTriggerSandbox = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.ENSURE_SANDBOX,
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
                preparedTriggerRun,
                resolvedTriggerConversationRoute,
                deliveryTaskId: activeTask.taskId,
                workflowRunId,
              },
            ),
        );

        const acquiredTriggerConnection = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.ACQUIRE_CONNECTION,
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            acquireTriggerConnection(
              {
                controlPlaneInternalClient,
              },
              {
                preparedTriggerRun,
                ensuredTriggerSandbox,
                deliveryTaskId: activeTask.taskId,
                workflowRunId,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.DELIVER_PAYLOAD,
              taskId: activeTask.taskId,
            }),
            retryPolicy: {
              maximumAttempts: 1,
            },
          },
          async () =>
            deliverConversationTriggerPayload(
              {
                controlPlaneInternalClient,
                db,
                dataPlaneClient,
              },
              {
                taskId: activeTask.taskId,
                generation: input.generation,
                preparedTriggerRun,
                resolvedTriggerConversationRoute,
                ensuredTriggerSandbox,
                acquiredTriggerConnection,
                workflowRunId,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.MARK_RUN_COMPLETED,
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            markTriggerRunCompleted(
              {
                db,
              },
              {
                triggerRunId: activeTask.triggerRunId,
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
            finalizeTriggerConversationDeliveryTask(
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

        logTriggerConversationDeliveryEvent({
          eventName: "delivery_task.completed",
          message: "Completed trigger conversation delivery task",
          telemetryContext: {
            triggerRunId: activeTask.triggerRunId,
            conversationId: preparedTriggerRunForTelemetry?.conversationId ?? input.conversationId,
            deliveryTaskId: activeTask.taskId,
            attemptCount: activeTask.attemptCount,
            processorGeneration: activeTask.processorGeneration,
            webhookEventId: preparedTriggerRunForTelemetry?.webhookEventId,
            workflowRunId,
          },
        });
      } catch (error) {
        const failure = resolveTriggerRunFailure(error);

        if (
          shouldRethrowDurableStepErrorForRetry(error) &&
          !isPermanentTriggerRunExecutionFailure(error)
        ) {
          logTriggerConversationDeliveryEvent({
            eventName: "delivery_task.step_retry",
            message: "Retrying trigger conversation delivery after durable step failure",
            telemetryContext: {
              triggerRunId: activeTask.triggerRunId,
              conversationId:
                preparedTriggerRunForTelemetry?.conversationId ?? input.conversationId,
              deliveryTaskId: activeTask.taskId,
              attemptCount: activeTask.attemptCount,
              processorGeneration: activeTask.processorGeneration,
              webhookEventId: preparedTriggerRunForTelemetry?.webhookEventId,
              workflowRunId,
            },
            attributes: {
              ...failure.metadata,
              ...resolveDurableStepRetryAttributes(error),
              "mistle.delivery.failure_code": failure.code,
              "mistle.delivery.failure_message": failure.message,
            },
            err: error,
            level: "warn",
          });
          throw error;
        }

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.MARK_RUN_FAILED,
              taskId: activeTask.taskId,
            }),
          },
          async () =>
            markTriggerRunFailed(
              {
                db,
              },
              {
                triggerRunId: activeTask.triggerRunId,
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
            finalizeTriggerConversationDeliveryTask(
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

        logTriggerConversationDeliveryEvent({
          eventName: "delivery_task.failed",
          message: "Failed trigger conversation delivery task",
          telemetryContext: {
            triggerRunId: activeTask.triggerRunId,
            conversationId: preparedTriggerRunForTelemetry?.conversationId ?? input.conversationId,
            deliveryTaskId: activeTask.taskId,
            attemptCount: activeTask.attemptCount,
            processorGeneration: activeTask.processorGeneration,
            webhookEventId: preparedTriggerRunForTelemetry?.webhookEventId,
            workflowRunId,
          },
          attributes: {
            ...failure.metadata,
            "mistle.delivery.failure_code": failure.code,
            "mistle.delivery.failure_message": failure.message,
          },
          err: error,
          level: "error",
        });
      }

      iteration += 1;
    }
  },
);

function resolveDurableStepRetryAttributes(error: unknown): Record<string, string | number> {
  const attributes: Record<string, string | number> = {};
  const stepName = getUnknownProperty(error, "stepName");
  if (typeof stepName === "string") {
    attributes["mistle.workflow.step_name"] = stepName;
  }

  const stepFailedAttempts = getUnknownProperty(error, "stepFailedAttempts");
  if (typeof stepFailedAttempts === "number") {
    attributes["mistle.workflow.step_failed_attempts"] = stepFailedAttempts;
  }

  const retryPolicy = getUnknownProperty(error, "retryPolicy");
  const maximumAttempts = getUnknownProperty(retryPolicy, "maximumAttempts");
  if (typeof maximumAttempts === "number") {
    attributes["mistle.workflow.step_maximum_attempts"] = maximumAttempts;
  }

  return attributes;
}

function getUnknownProperty(input: unknown, key: string): unknown {
  if (typeof input !== "object" || input === null || !(key in input)) {
    return undefined;
  }

  return Reflect.get(input, key);
}
