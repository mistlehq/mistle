import {
  HandleAutomationRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../core/context.js";
import { markIntegrationWebhookEventFailed } from "./mark-integration-webhook-event-failed.js";
import { markIntegrationWebhookEventProcessed } from "./mark-integration-webhook-event-processed.js";
import { prepareIntegrationWebhookEvent } from "./prepare-integration-webhook-event.js";

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
