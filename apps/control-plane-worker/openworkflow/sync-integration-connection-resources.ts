import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const SyncIntegrationConnectionResourcesWorkflow = defineWorkflow(
  SyncIntegrationConnectionResourcesWorkflowSpec,
  async ({ input, step }) => {
    const {
      services: { integrationConnectionResources },
    } = await getWorkflowContext();

    return step.run({ name: "sync-integration-connection-resources" }, async () =>
      integrationConnectionResources.syncIntegrationConnectionResources(input),
    );
  },
);
