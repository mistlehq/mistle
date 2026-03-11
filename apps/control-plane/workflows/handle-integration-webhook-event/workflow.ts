import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { handleIntegrationWebhookEvent } from "../../src/worker/runtime/services/handle-integration-webhook-event.js";
import { HandleAutomationRunWorkflow } from "../handle-automation-run/index.js";
import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";

export type HandleIntegrationWebhookEventWorkflowInput = {
  webhookEventId: string;
};

export type HandleIntegrationWebhookEventWorkflowOutput = {
  webhookEventId: string;
};

/**
 * Creates the control-plane webhook handling workflow.
 */
export const HandleIntegrationWebhookEventWorkflow = defineWorkflow(
  defineWorkflowSpec<
    HandleIntegrationWebhookEventWorkflowInput,
    HandleIntegrationWebhookEventWorkflowOutput
  >({
    name: "control-plane.integration-webhooks.handle-event",
    version: "1",
  }),
  async ({ input: workflowInput, step }) => {
    const runtime = await getControlPlaneWorkflowRuntime();

    return step.run({ name: "handle-webhook-event" }, async () =>
      handleIntegrationWebhookEvent(
        {
          db: runtime.db,
          integrationRegistry: runtime.integrationRegistry,
          enqueueAutomationRuns: async ({ automationRunIds }) => {
            for (const automationRunId of automationRunIds) {
              await runtime.openWorkflow.runWorkflow(
                HandleAutomationRunWorkflow.spec,
                {
                  automationRunId,
                },
                {
                  idempotencyKey: automationRunId,
                },
              );
            }
          },
          enqueueResourceSync: async ({ organizationId, connectionId, kind }) => {
            await runtime.controlPlaneInternalClient.requestIntegrationConnectionResourceRefresh({
              organizationId,
              connectionId,
              kind,
            });
          },
        },
        workflowInput,
      ),
    );
  },
);

export const HandleIntegrationWebhookEventWorkflowSpec = HandleIntegrationWebhookEventWorkflow.spec;
