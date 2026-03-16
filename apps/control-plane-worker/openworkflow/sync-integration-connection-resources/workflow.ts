import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../../src/openworkflow/context.js";
import { syncIntegrationConnectionResources } from "./sync-integration-connection-resources.js";

export const SyncIntegrationConnectionResourcesWorkflow = defineWorkflow(
  SyncIntegrationConnectionResourcesWorkflowSpec,
  async ({ input, step }) => {
    const { controlPlaneInternalClient, db, integrationRegistry } = await getWorkflowContext();

    return step.run({ name: "sync-integration-connection-resources" }, async () =>
      syncIntegrationConnectionResources(
        {
          db,
          integrationRegistry,
          controlPlaneInternalClient,
        },
        input,
      ),
    );
  },
);
