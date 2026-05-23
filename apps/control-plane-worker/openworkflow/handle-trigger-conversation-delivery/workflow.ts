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
import {
  beginConversationTriggerPayloadDelivery,
  createConversationProviderDeliveryInput,
  loadOrCreateTriggerConversationDeliveryRoute,
  persistConversationProviderDeliveryResult,
  seedDeliveredSandboxInstanceTitle,
} from "./deliver-conversation-trigger-payload.js";
import {
  createConversationIdempotencyMetadata,
  submitPayloadIdempotencyMetadata,
} from "./delivery-idempotency.js";
import { ensureConversationDeliverySandbox } from "./ensure-conversation-delivery-sandbox.js";
import {
  createConversationProviderDeliveryConversation,
  inspectAndResumeConversationProviderDeliveryConversation,
  submitConversationProviderDeliveryPayload,
} from "./execute-conversation-provider-delivery.js";
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
  BEGIN_PAYLOAD_DELIVERY: "begin-automation-payload-delivery",
  LOAD_OR_CREATE_ROUTE: "load-or-create-automation-conversation-route",
  CREATE_PROVIDER_CONVERSATION: "create-automation-provider-conversation",
  INSPECT_RESUME_PROVIDER_CONVERSATION: "inspect-resume-automation-provider-conversation",
  SUBMIT_PROVIDER_PAYLOAD: "submit-automation-provider-payload",
  PERSIST_PROVIDER_DELIVERY: "persist-automation-provider-delivery",
  SEED_SANDBOX_TITLE: "seed-automation-sandbox-title",
  MARK_RUN_COMPLETED: "mark-automation-run-completed",
  MARK_RUN_FAILED: "mark-automation-run-failed",
} as const;

const SingleAttemptDeliveryStepRetryPolicy = {
  maximumAttempts: 1,
} as const;

const IdempotentProviderDeliveryStepRetryPolicy = {
  maximumAttempts: 3,
} as const;

function resolveProviderCreateConversationRetryPolicy(input: {
  runtimeId: string;
}): typeof IdempotentProviderDeliveryStepRetryPolicy | typeof SingleAttemptDeliveryStepRetryPolicy {
  switch (input.runtimeId) {
    case "codex":
    case "pi":
    case "opencode":
      return IdempotentProviderDeliveryStepRetryPolicy;
    default:
      return SingleAttemptDeliveryStepRetryPolicy;
  }
}

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
              prefix: DurableTriggerConversationDeliveryStepPrefixes.BEGIN_PAYLOAD_DELIVERY,
              taskId: activeTask.taskId,
            }),
            retryPolicy: SingleAttemptDeliveryStepRetryPolicy,
          },
          async () =>
            beginConversationTriggerPayloadDelivery(
              {
                db,
              },
              {
                taskId: activeTask.taskId,
                generation: input.generation,
              },
            ),
        );

        const loadedRoute = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.LOAD_OR_CREATE_ROUTE,
              taskId: activeTask.taskId,
            }),
            retryPolicy: SingleAttemptDeliveryStepRetryPolicy,
          },
          async () =>
            loadOrCreateTriggerConversationDeliveryRoute(
              {
                db,
              },
              {
                taskId: activeTask.taskId,
                preparedTriggerRun,
                resolvedTriggerConversationRoute,
                ensuredTriggerSandbox,
                workflowRunId,
              },
            ),
        );

        const providerDeliveryInput = createConversationProviderDeliveryInput({
          taskId: activeTask.taskId,
          preparedTriggerRun,
          resolvedTriggerConversationRoute,
          ensuredTriggerSandbox,
          acquiredTriggerConnection,
          activeRoute: loadedRoute.activeRoute,
        });
        const createConversationIdempotency =
          createConversationIdempotencyMetadata(providerDeliveryInput);

        const createdProviderConversation = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.CREATE_PROVIDER_CONVERSATION,
              taskId: activeTask.taskId,
            }),
            retryPolicy: resolveProviderCreateConversationRetryPolicy({
              runtimeId: resolvedTriggerConversationRoute.runtimeId,
            }),
          },
          async () =>
            withTriggerConversationDeliverySpan(
              {
                name: "trigger_conversation_delivery.provider.create_conversation",
                telemetryContext: {
                  triggerRunId: preparedTriggerRun.triggerRunId,
                  conversationId: preparedTriggerRun.conversationId,
                  deliveryTaskId: activeTask.taskId,
                  routeId: loadedRoute.activeRoute.id,
                  sandboxInstanceId: ensuredTriggerSandbox.sandboxInstanceId,
                  webhookEventId: preparedTriggerRun.webhookEventId,
                  workflowRunId,
                },
              },
              async (span) => {
                span.setAttributes({
                  "mistle.provider.idempotency_key": createConversationIdempotency.key,
                  "mistle.provider.idempotency_operation": createConversationIdempotency.operation,
                  "mistle.provider.idempotency_request_fingerprint":
                    createConversationIdempotency.requestFingerprint,
                });
                const result =
                  await createConversationProviderDeliveryConversation(providerDeliveryInput);
                span.setAttribute("mistle.provider.conversation_id", result.providerConversationId);
                return result;
              },
            ),
        );

        const inspectedProviderConversation = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix:
                DurableTriggerConversationDeliveryStepPrefixes.INSPECT_RESUME_PROVIDER_CONVERSATION,
              taskId: activeTask.taskId,
            }),
            retryPolicy: SingleAttemptDeliveryStepRetryPolicy,
          },
          async () =>
            inspectAndResumeConversationProviderDeliveryConversation({
              deliveryInput: providerDeliveryInput,
              providerConversationId: createdProviderConversation.providerConversationId,
            }),
        );

        const submittedProviderPayload = await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.SUBMIT_PROVIDER_PAYLOAD,
              taskId: activeTask.taskId,
            }),
            retryPolicy: IdempotentProviderDeliveryStepRetryPolicy,
          },
          async () =>
            withTriggerConversationDeliverySpan(
              {
                name: "trigger_conversation_delivery.provider.submit",
                telemetryContext: {
                  triggerRunId: preparedTriggerRun.triggerRunId,
                  conversationId: preparedTriggerRun.conversationId,
                  deliveryTaskId: activeTask.taskId,
                  routeId: loadedRoute.activeRoute.id,
                  sandboxInstanceId: ensuredTriggerSandbox.sandboxInstanceId,
                  webhookEventId: preparedTriggerRun.webhookEventId,
                  workflowRunId,
                },
              },
              async (span) => {
                const submitPayloadIdempotency = submitPayloadIdempotencyMetadata({
                  deliveryInput: providerDeliveryInput,
                  providerConversationId: createdProviderConversation.providerConversationId,
                });
                span.setAttribute("mistle.route.binding_action", loadedRoute.routeBindingAction);
                span.setAttributes({
                  "mistle.provider.idempotency_key": submitPayloadIdempotency.key,
                  "mistle.provider.idempotency_operation": submitPayloadIdempotency.operation,
                  "mistle.provider.idempotency_request_fingerprint":
                    submitPayloadIdempotency.requestFingerprint,
                });
                const result = await submitConversationProviderDeliveryPayload({
                  deliveryInput: providerDeliveryInput,
                  inspectTriggerConversation: inspectedProviderConversation,
                  providerConversationId: createdProviderConversation.providerConversationId,
                });
                span.setAttributes({
                  "mistle.provider.conversation_id":
                    createdProviderConversation.providerConversationId,
                  ...(result.providerExecutionId === null
                    ? {}
                    : { "mistle.provider.execution_id": result.providerExecutionId }),
                });
                return result;
              },
            ),
        );

        const deliveryResult = {
          providerConversationId: createdProviderConversation.providerConversationId,
          providerExecutionId: submittedProviderPayload.providerExecutionId,
          providerState:
            submittedProviderPayload.providerState ?? createdProviderConversation.providerState,
        };

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.PERSIST_PROVIDER_DELIVERY,
              taskId: activeTask.taskId,
            }),
            retryPolicy: SingleAttemptDeliveryStepRetryPolicy,
          },
          async () =>
            persistConversationProviderDeliveryResult(
              {
                db,
              },
              {
                preparedTriggerRun,
                ensuredTriggerSandbox,
                activeRoute: loadedRoute.activeRoute,
                routeBindingAction: loadedRoute.routeBindingAction,
                deliveryResult,
              },
            ),
        );

        await step.run(
          {
            name: getConversationDeliveryStepName({
              prefix: DurableTriggerConversationDeliveryStepPrefixes.SEED_SANDBOX_TITLE,
              taskId: activeTask.taskId,
            }),
            retryPolicy: SingleAttemptDeliveryStepRetryPolicy,
          },
          async () =>
            seedDeliveredSandboxInstanceTitle(
              {
                controlPlaneInternalClient,
                dataPlaneClient,
              },
              {
                taskId: activeTask.taskId,
                preparedTriggerRun,
                resolvedTriggerConversationRoute,
                ensuredTriggerSandbox,
                activeRoute: loadedRoute.activeRoute,
                deliveryResult,
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
