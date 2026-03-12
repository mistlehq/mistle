import {
  createHandleIntegrationWebhookEventWorkflow,
  HandleIntegrationWebhookEventWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const HandleIntegrationWebhookEventWorkflow = defineWorkflow(
  HandleIntegrationWebhookEventWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { integrationWebhooks },
    } = await getWorkflowContext();
    const workflow = createHandleIntegrationWebhookEventWorkflow(integrationWebhooks);

    return workflow.fn(workflowContext);
  },
);
