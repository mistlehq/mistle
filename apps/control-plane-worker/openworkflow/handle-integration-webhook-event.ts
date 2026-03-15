import {
  HandleAutomationRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";
import {
  markIntegrationWebhookEventFailed,
  markIntegrationWebhookEventProcessed,
  prepareIntegrationWebhookEvent,
} from "../src/runtime/services/handle-integration-webhook-event.js";

export const HandleIntegrationWebhookEventWorkflow = defineWorkflow(
  HandleIntegrationWebhookEventWorkflowSpec,
  async ({ input, step }) => {
    const { controlPlaneInternalClient, db, integrationRegistry, openWorkflow } =
      await getWorkflowContext();

    return step.run({ name: "handle-webhook-event" }, async () => {
      const preparedWebhookEvent = await prepareIntegrationWebhookEvent(
        {
          db,
          integrationRegistry,
        },
        input,
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
