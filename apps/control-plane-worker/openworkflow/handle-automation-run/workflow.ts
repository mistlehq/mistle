import {
  HandleAutomationConversationDeliveryWorkflowSpec,
  HandleAutomationRunWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { prepareAutomationRun, resolveAutomationRunFailure } from "../shared/automation-run.js";
import { markAutomationRunFailed } from "../shared/automation-run.js";
import { setAutomationConversationDeliveryProcessorIdle } from "../shared/set-conversation-delivery-processor-idle.js";
import {
  createWebhookDeliveryTelemetryAttributes,
  logWebhookDeliveryEvent,
} from "../shared/webhook-delivery-telemetry.js";
import { handoffAutomationRunDelivery } from "./handoff-automation-run-delivery.js";
import { transitionAutomationRunToRunning } from "./transition-automation-run-to-running.js";

export const HandleAutomationRunWorkflow = defineTracedControlPlaneWorkflow(
  HandleAutomationRunWorkflowSpec,
  async ({ input, step }) => {
    const { db, openWorkflow } = await getWorkflowContext();

    const transitionResult = await step.run(
      { name: "transition-automation-run-to-running" },
      async () =>
        transitionAutomationRunToRunning(
          {
            db,
          },
          input,
        ),
    );
    if (!transitionResult.shouldProcess) {
      return {
        automationRunId: input.automationRunId,
      };
    }

    try {
      const preparedAutomationRun = await step.run({ name: "prepare-automation-run" }, async () =>
        prepareAutomationRun(
          {
            db,
          },
          input,
        ),
      );

      await step.run({ name: "handoff-automation-run-delivery" }, async () => {
        const stepSpan = trace.getActiveSpan();

        stepSpan?.setAttributes(
          createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedAutomationRun.webhookEventId,
            externalDeliveryId: preparedAutomationRun.webhookExternalDeliveryId ?? undefined,
            automationRunId: preparedAutomationRun.automationRunId,
            integrationConnectionId: preparedAutomationRun.integrationConnectionId,
            targetKey: preparedAutomationRun.targetKey,
          }),
        );

        const deliveryHandoff = await handoffAutomationRunDelivery(
          {
            db,
          },
          {
            preparedAutomationRun,
          },
        );

        stepSpan?.setAttributes(
          createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedAutomationRun.webhookEventId,
            externalDeliveryId: preparedAutomationRun.webhookExternalDeliveryId ?? undefined,
            automationRunId: preparedAutomationRun.automationRunId,
            conversationId: deliveryHandoff.conversationId,
            deliveryTaskId: deliveryHandoff.deliveryTaskId,
            integrationConnectionId: preparedAutomationRun.integrationConnectionId,
            targetKey: preparedAutomationRun.targetKey,
          }),
        );

        logWebhookDeliveryEvent({
          eventName: "delivery_task.queued",
          message: "Queued automation conversation delivery task",
          telemetryContext: {
            webhookEventId: preparedAutomationRun.webhookEventId,
            externalDeliveryId: preparedAutomationRun.webhookExternalDeliveryId ?? undefined,
            automationRunId: preparedAutomationRun.automationRunId,
            conversationId: deliveryHandoff.conversationId,
            deliveryTaskId: deliveryHandoff.deliveryTaskId,
            integrationConnectionId: preparedAutomationRun.integrationConnectionId,
            targetKey: preparedAutomationRun.targetKey,
          },
          attributes: {
            "mistle.delivery.processor_generation": deliveryHandoff.generation,
            "mistle.delivery.processor_started": deliveryHandoff.shouldStart,
          },
        });

        stepSpan?.addEvent("delivery_task.queued", {
          ...createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedAutomationRun.webhookEventId,
            externalDeliveryId: preparedAutomationRun.webhookExternalDeliveryId ?? undefined,
            automationRunId: preparedAutomationRun.automationRunId,
            conversationId: deliveryHandoff.conversationId,
            deliveryTaskId: deliveryHandoff.deliveryTaskId,
            integrationConnectionId: preparedAutomationRun.integrationConnectionId,
            targetKey: preparedAutomationRun.targetKey,
          }),
          "mistle.delivery.processor_generation": deliveryHandoff.generation,
          "mistle.delivery.processor_started": deliveryHandoff.shouldStart,
        });

        if (!deliveryHandoff.shouldStart) {
          return;
        }

        try {
          await openWorkflow.runWorkflow(
            HandleAutomationConversationDeliveryWorkflowSpec,
            {
              conversationId: deliveryHandoff.conversationId,
              generation: deliveryHandoff.generation,
            },
            {
              idempotencyKey: `automation-conversation-delivery:${deliveryHandoff.conversationId}:${String(deliveryHandoff.generation)}`,
            },
          );

          stepSpan?.addEvent(
            "delivery_workflow.scheduled",
            createWebhookDeliveryTelemetryAttributes({
              webhookEventId: preparedAutomationRun.webhookEventId,
              externalDeliveryId: preparedAutomationRun.webhookExternalDeliveryId ?? undefined,
              automationRunId: preparedAutomationRun.automationRunId,
              conversationId: deliveryHandoff.conversationId,
              deliveryTaskId: deliveryHandoff.deliveryTaskId,
              integrationConnectionId: preparedAutomationRun.integrationConnectionId,
              targetKey: preparedAutomationRun.targetKey,
            }),
          );
        } catch (error) {
          await setAutomationConversationDeliveryProcessorIdle(
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
      const failure = resolveAutomationRunFailure(error);
      await step.run({ name: "mark-automation-run-failed" }, async () =>
        markAutomationRunFailed(
          {
            db,
          },
          {
            automationRunId: input.automationRunId,
            failureCode: failure.code,
            failureMessage: failure.message,
          },
        ),
      );
      throw error;
    }

    return {
      automationRunId: input.automationRunId,
    };
  },
);
