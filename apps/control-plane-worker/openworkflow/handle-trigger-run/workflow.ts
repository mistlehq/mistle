import {
  type HandleTriggerRunWorkflowInput,
  HandleTriggerConversationDeliveryWorkflowSpec,
  HandleTriggerRunWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { setTriggerConversationDeliveryProcessorIdle } from "../shared/set-conversation-delivery-processor-idle.js";
import { prepareTriggerRun, resolveTriggerRunFailure } from "../shared/trigger-run.js";
import { markTriggerRunFailed } from "../shared/trigger-run.js";
import {
  createWebhookDeliveryTelemetryAttributes,
  logWebhookDeliveryEvent,
} from "../shared/webhook-delivery-telemetry.js";
import { handoffTriggerRunDelivery } from "./handoff-trigger-run-delivery.js";
import { transitionTriggerRunToRunning } from "./transition-trigger-run-to-running.js";

export const DurableHandleTriggerRunStepNames = {
  TRANSITION_TO_RUNNING: "transition-automation-run-to-running",
  PREPARE_RUN: "prepare-automation-run",
  HANDOFF_DELIVERY: "handoff-automation-run-delivery",
  MARK_FAILED: "mark-automation-run-failed",
} as const;

export function normalizeHandleTriggerRunWorkflowInput(input: HandleTriggerRunWorkflowInput): {
  triggerRunId: string;
} {
  if (input.triggerRunId !== undefined) {
    return {
      triggerRunId: input.triggerRunId,
    };
  }

  return {
    triggerRunId: input.automationRunId,
  };
}

export const HandleTriggerRunWorkflow = defineTracedControlPlaneWorkflow(
  HandleTriggerRunWorkflowSpec,
  async ({ input, step }) => {
    const { db, openWorkflow } = await getWorkflowContext();
    const workflowInput = normalizeHandleTriggerRunWorkflowInput(input);

    const transitionResult = await step.run(
      { name: DurableHandleTriggerRunStepNames.TRANSITION_TO_RUNNING },
      async () =>
        transitionTriggerRunToRunning(
          {
            db,
          },
          workflowInput,
        ),
    );
    if (!transitionResult.shouldProcess) {
      return {
        triggerRunId: workflowInput.triggerRunId,
      };
    }

    try {
      const preparedTriggerRun = await step.run(
        { name: DurableHandleTriggerRunStepNames.PREPARE_RUN },
        async () =>
          prepareTriggerRun(
            {
              db,
            },
            workflowInput,
          ),
      );

      await step.run({ name: DurableHandleTriggerRunStepNames.HANDOFF_DELIVERY }, async () => {
        const stepSpan = trace.getActiveSpan();

        stepSpan?.setAttributes(
          createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedTriggerRun.webhookEventId,
            externalDeliveryId: preparedTriggerRun.webhookExternalDeliveryId ?? undefined,
            triggerRunId: preparedTriggerRun.triggerRunId,
            integrationConnectionId: preparedTriggerRun.integrationConnectionId,
            targetKey: preparedTriggerRun.targetKey,
          }),
        );

        const deliveryHandoff = await handoffTriggerRunDelivery(
          {
            db,
          },
          {
            preparedTriggerRun,
          },
        );

        stepSpan?.setAttributes(
          createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedTriggerRun.webhookEventId,
            externalDeliveryId: preparedTriggerRun.webhookExternalDeliveryId ?? undefined,
            triggerRunId: preparedTriggerRun.triggerRunId,
            conversationId: deliveryHandoff.conversationId,
            deliveryTaskId: deliveryHandoff.deliveryTaskId,
            integrationConnectionId: preparedTriggerRun.integrationConnectionId,
            targetKey: preparedTriggerRun.targetKey,
          }),
        );

        logWebhookDeliveryEvent({
          eventName: "delivery_task.queued",
          message: "Queued trigger conversation delivery task",
          telemetryContext: {
            webhookEventId: preparedTriggerRun.webhookEventId,
            externalDeliveryId: preparedTriggerRun.webhookExternalDeliveryId ?? undefined,
            triggerRunId: preparedTriggerRun.triggerRunId,
            conversationId: deliveryHandoff.conversationId,
            deliveryTaskId: deliveryHandoff.deliveryTaskId,
            integrationConnectionId: preparedTriggerRun.integrationConnectionId,
            targetKey: preparedTriggerRun.targetKey,
          },
          attributes: {
            "mistle.delivery.processor_generation": deliveryHandoff.generation,
            "mistle.delivery.processor_started": deliveryHandoff.shouldStart,
          },
        });

        stepSpan?.addEvent("delivery_task.queued", {
          ...createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedTriggerRun.webhookEventId,
            externalDeliveryId: preparedTriggerRun.webhookExternalDeliveryId ?? undefined,
            triggerRunId: preparedTriggerRun.triggerRunId,
            conversationId: deliveryHandoff.conversationId,
            deliveryTaskId: deliveryHandoff.deliveryTaskId,
            integrationConnectionId: preparedTriggerRun.integrationConnectionId,
            targetKey: preparedTriggerRun.targetKey,
          }),
          "mistle.delivery.processor_generation": deliveryHandoff.generation,
          "mistle.delivery.processor_started": deliveryHandoff.shouldStart,
        });

        if (!deliveryHandoff.shouldStart) {
          return;
        }

        try {
          await openWorkflow.runWorkflow(
            HandleTriggerConversationDeliveryWorkflowSpec,
            {
              conversationId: deliveryHandoff.conversationId,
              generation: deliveryHandoff.generation,
            },
            {
              idempotencyKey: `trigger-conversation-delivery:${deliveryHandoff.conversationId}:${String(deliveryHandoff.generation)}`,
            },
          );

          stepSpan?.addEvent(
            "delivery_workflow.scheduled",
            createWebhookDeliveryTelemetryAttributes({
              webhookEventId: preparedTriggerRun.webhookEventId,
              externalDeliveryId: preparedTriggerRun.webhookExternalDeliveryId ?? undefined,
              triggerRunId: preparedTriggerRun.triggerRunId,
              conversationId: deliveryHandoff.conversationId,
              deliveryTaskId: deliveryHandoff.deliveryTaskId,
              integrationConnectionId: preparedTriggerRun.integrationConnectionId,
              targetKey: preparedTriggerRun.targetKey,
            }),
          );
        } catch (error) {
          await setTriggerConversationDeliveryProcessorIdle(
            {
              db,
            },
            {
              conversationId: deliveryHandoff.conversationId,
              generation: deliveryHandoff.generation,
            },
          );
          throw error;
        }
      });
    } catch (error) {
      const failure = resolveTriggerRunFailure(error);
      await step.run({ name: DurableHandleTriggerRunStepNames.MARK_FAILED }, async () =>
        markTriggerRunFailed(
          {
            db,
          },
          {
            triggerRunId: workflowInput.triggerRunId,
            failureCode: failure.code,
            failureMessage: failure.message,
          },
        ),
      );
      throw error;
    }

    return {
      triggerRunId: workflowInput.triggerRunId,
    };
  },
);
