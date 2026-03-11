import { defineWorkflow, type Workflow } from "openworkflow";

import {
  HandleIntegrationWebhookEventWorkflowSpec,
  type HandleIntegrationWebhookEventWorkflowInput,
  type HandleIntegrationWebhookEventWorkflowOutput,
} from "./spec.js";

export type CreateHandleIntegrationWebhookEventWorkflowInput = {
  handleWebhookEvent: (
    input: HandleIntegrationWebhookEventWorkflowInput,
  ) => Promise<HandleIntegrationWebhookEventWorkflowOutput>;
};

/**
 * Creates the control-plane webhook handling workflow.
 */
export function createHandleIntegrationWebhookEventWorkflow(
  input: CreateHandleIntegrationWebhookEventWorkflowInput,
): Workflow<
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
  HandleIntegrationWebhookEventWorkflowInput
> {
  return defineWorkflow(
    HandleIntegrationWebhookEventWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      return step.run({ name: "handle-webhook-event" }, async () =>
        input.handleWebhookEvent(workflowInput),
      );
    },
  );
}
