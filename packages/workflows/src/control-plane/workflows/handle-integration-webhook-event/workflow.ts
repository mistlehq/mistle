import { defineWorkflow, type Workflow } from "openworkflow";

import {
  HandleIntegrationWebhookEventWorkflowSpec,
  type HandleIntegrationWebhookEventWorkflowInput,
  type HandleIntegrationWebhookEventWorkflowOutput,
} from "./spec.js";

/**
 * Creates the control-plane webhook handling workflow.
 * This is intentionally a no-op placeholder until downstream forwarding is added.
 */
export function createHandleIntegrationWebhookEventWorkflow(): Workflow<
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
  HandleIntegrationWebhookEventWorkflowInput
> {
  return defineWorkflow(
    HandleIntegrationWebhookEventWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      await step.run({ name: "noop-handle-webhook-event" }, async () => {
        return;
      });

      return {
        webhookEventId: workflowInput.webhookEventId,
      };
    },
  );
}
