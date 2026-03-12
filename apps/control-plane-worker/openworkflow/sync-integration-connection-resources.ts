import {
  createSyncIntegrationConnectionResourcesWorkflow,
  SyncIntegrationConnectionResourcesWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const SyncIntegrationConnectionResourcesWorkflow = defineWorkflow(
  SyncIntegrationConnectionResourcesWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { integrationConnectionResources },
    } = await getWorkflowContext();
    const workflow = createSyncIntegrationConnectionResourcesWorkflow(
      integrationConnectionResources,
    );

    return workflow.fn(workflowContext);
  },
);
