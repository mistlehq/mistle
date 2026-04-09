import { SyncIntegrationConnectionResourcesWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { syncIntegrationConnectionResources } from "./sync-integration-connection-resources.js";

export const SyncIntegrationConnectionResourcesWorkflow = defineTracedControlPlaneWorkflow(
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
