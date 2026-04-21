import {
  HandleAutomationRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { trace } from "@opentelemetry/api";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import {
  createWebhookDeliveryTelemetryAttributes,
  logWebhookDeliveryEvent,
} from "../shared/webhook-delivery-telemetry.js";
import { markIntegrationWebhookEventFailed } from "./mark-integration-webhook-event-failed.js";
import { markIntegrationWebhookEventProcessed } from "./mark-integration-webhook-event-processed.js";
import { prepareIntegrationWebhookEvent } from "./prepare-integration-webhook-event.js";

export const HandleIntegrationWebhookEventWorkflow = defineTracedControlPlaneWorkflow(
  HandleIntegrationWebhookEventWorkflowSpec,
  async ({ input, step }) => {
    const { controlPlaneInternalClient, db, integrationRegistry, openWorkflow } =
      await getWorkflowContext();

    return step.run({ name: "handle-webhook-event" }, async () => {
      const stepSpan = trace.getActiveSpan();

      stepSpan?.setAttributes(
        createWebhookDeliveryTelemetryAttributes({
          webhookEventId: input.webhookEventId,
        }),
      );

      const preparedWebhookEvent = await prepareIntegrationWebhookEvent(
        {
          db,
          integrationRegistry,
        },
        input,
      );

      stepSpan?.setAttributes(
        createWebhookDeliveryTelemetryAttributes({
          webhookEventId: preparedWebhookEvent.webhookEventId,
          externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
          integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
          targetKey: preparedWebhookEvent.targetKey,
        }),
      );

      if (preparedWebhookEvent.finalized) {
        return {
          webhookEventId: input.webhookEventId,
        };
      }

      try {
        for (const resourceSyncRequest of preparedWebhookEvent.resourceSyncRequests) {
          await controlPlaneInternalClient.requestIntegrationConnectionResourceRefresh(
            resourceSyncRequest,
          );
        }

        for (const automationRunId of preparedWebhookEvent.automationRunIds) {
          await openWorkflow.runWorkflow(
            HandleAutomationRunWorkflowSpec,
            {
              automationRunId,
            },
            {
              idempotencyKey: automationRunId,
            },
          );

          const automationRunAttributes = createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedWebhookEvent.webhookEventId,
            externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
            automationRunId,
            integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
            targetKey: preparedWebhookEvent.targetKey,
          });

          stepSpan?.addEvent("automation_run.schedule", automationRunAttributes);

          logWebhookDeliveryEvent({
            eventName: "automation_run.queued",
            message: "Queued automation run from webhook event",
            telemetryContext: {
              webhookEventId: preparedWebhookEvent.webhookEventId,
              externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
              automationRunId,
              integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
              targetKey: preparedWebhookEvent.targetKey,
            },
          });
        }

        await markIntegrationWebhookEventProcessed(
          {
            db,
          },
          {
            webhookEventId: input.webhookEventId,
          },
        );
      } catch (error) {
        await markIntegrationWebhookEventFailed(
          {
            db,
          },
          {
            webhookEventId: input.webhookEventId,
          },
        );
        throw error;
      }

      return {
        webhookEventId: input.webhookEventId,
      };
    });
  },
);
