import { HandleIntegrationWebhookEventWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const HandleIntegrationWebhookEventWorkflow = defineWorkflow(
  HandleIntegrationWebhookEventWorkflowSpec,
  async ({ input, step }) => {
    const {
      services: { integrationWebhooks },
    } = await getWorkflowContext();

    return step.run({ name: "handle-webhook-event" }, async () =>
      integrationWebhooks.handleWebhookEvent(input),
    );
  },
);
