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
  withWebhookDeliverySpan,
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

      const preparedWebhookEvent = await withWebhookDeliverySpan(
        {
          name: "webhook_event.prepare",
          telemetryContext: {
            webhookEventId: input.webhookEventId,
          },
        },
        async (span) => {
          const preparedEvent = await prepareIntegrationWebhookEvent(
            {
              db,
              integrationRegistry,
            },
            input,
          );

          span.setAttributes({
            ...createWebhookDeliveryTelemetryAttributes({
              webhookEventId: preparedEvent.webhookEventId,
              externalDeliveryId: preparedEvent.externalDeliveryId ?? undefined,
              integrationConnectionId: preparedEvent.integrationConnectionId,
              targetKey: preparedEvent.targetKey,
            }),
            "mistle.automation.run.count": preparedEvent.automationRunIds.length,
            "mistle.webhook.event_status": preparedEvent.webhookEventStatus,
            "mistle.webhook.finalized": preparedEvent.finalized,
            "mistle.webhook.resource_sync.count": preparedEvent.resourceSyncRequests.length,
          });

          return preparedEvent;
        },
      );

      stepSpan?.setAttributes({
        ...createWebhookDeliveryTelemetryAttributes({
          webhookEventId: preparedWebhookEvent.webhookEventId,
          externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
          integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
          targetKey: preparedWebhookEvent.targetKey,
        }),
        "mistle.automation.run.count": preparedWebhookEvent.automationRunIds.length,
        "mistle.webhook.event_status": preparedWebhookEvent.webhookEventStatus,
        "mistle.webhook.finalized": preparedWebhookEvent.finalized,
        "mistle.webhook.resource_sync.count": preparedWebhookEvent.resourceSyncRequests.length,
      });

      if (preparedWebhookEvent.finalized) {
        stepSpan?.setAttribute(
          "mistle.webhook.final_status",
          preparedWebhookEvent.webhookEventStatus,
        );
        stepSpan?.addEvent("webhook_event.finalized", {
          "mistle.webhook.event_id": input.webhookEventId,
          "mistle.webhook.final_status": preparedWebhookEvent.webhookEventStatus,
        });

        return {
          webhookEventId: input.webhookEventId,
        };
      }

      try {
        for (const resourceSyncRequest of preparedWebhookEvent.resourceSyncRequests) {
          await withWebhookDeliverySpan(
            {
              name: "webhook_event.resource_sync.schedule",
              telemetryContext: {
                webhookEventId: preparedWebhookEvent.webhookEventId,
                externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
                integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
                targetKey: preparedWebhookEvent.targetKey,
              },
            },
            async (span) => {
              span.setAttribute("mistle.integration.resource.kind", resourceSyncRequest.kind);

              await controlPlaneInternalClient.requestIntegrationConnectionResourceRefresh(
                resourceSyncRequest,
              );
            },
          );
        }

        for (const automationRunId of preparedWebhookEvent.automationRunIds) {
          const automationRunAttributes = createWebhookDeliveryTelemetryAttributes({
            webhookEventId: preparedWebhookEvent.webhookEventId,
            externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
            automationRunId,
            integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
            targetKey: preparedWebhookEvent.targetKey,
          });

          await withWebhookDeliverySpan(
            {
              name: "webhook_event.automation_run.schedule",
              telemetryContext: {
                webhookEventId: preparedWebhookEvent.webhookEventId,
                externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
                automationRunId,
                integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
                targetKey: preparedWebhookEvent.targetKey,
              },
            },
            async (span) => {
              await openWorkflow.runWorkflow(
                HandleAutomationRunWorkflowSpec,
                {
                  automationRunId,
                },
                {
                  idempotencyKey: automationRunId,
                },
              );

              span.addEvent("automation_run.queued", automationRunAttributes);
            },
          );

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

        await withWebhookDeliverySpan(
          {
            name: "webhook_event.mark_processed",
            telemetryContext: {
              webhookEventId: preparedWebhookEvent.webhookEventId,
              externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
              integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
              targetKey: preparedWebhookEvent.targetKey,
            },
          },
          async (span) => {
            await markIntegrationWebhookEventProcessed(
              {
                db,
              },
              {
                webhookEventId: input.webhookEventId,
              },
            );

            span.setAttribute("mistle.webhook.final_status", "processed");
            stepSpan?.setAttribute("mistle.webhook.final_status", "processed");
          },
        );
      } catch (error) {
        await withWebhookDeliverySpan(
          {
            name: "webhook_event.mark_failed",
            telemetryContext: {
              webhookEventId: preparedWebhookEvent.webhookEventId,
              externalDeliveryId: preparedWebhookEvent.externalDeliveryId ?? undefined,
              integrationConnectionId: preparedWebhookEvent.integrationConnectionId,
              targetKey: preparedWebhookEvent.targetKey,
            },
          },
          async (span) => {
            await markIntegrationWebhookEventFailed(
              {
                db,
              },
              {
                webhookEventId: input.webhookEventId,
              },
            );

            span.setAttribute("mistle.webhook.final_status", "failed");
            stepSpan?.setAttribute("mistle.webhook.final_status", "failed");
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
