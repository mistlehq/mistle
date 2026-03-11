import { defineWorkflow, type Workflow } from "openworkflow";

import {
  SyncIntegrationConnectionResourcesWorkflowSpec,
  type SyncIntegrationConnectionResourcesWorkflowInput,
  type SyncIntegrationConnectionResourcesWorkflowOutput,
} from "./spec.js";

export type CreateSyncIntegrationConnectionResourcesWorkflowInput = {
  syncIntegrationConnectionResources: (
    input: SyncIntegrationConnectionResourcesWorkflowInput,
  ) => Promise<SyncIntegrationConnectionResourcesWorkflowOutput>;
};

export function createSyncIntegrationConnectionResourcesWorkflow(
  input: CreateSyncIntegrationConnectionResourcesWorkflowInput,
): Workflow<
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
  SyncIntegrationConnectionResourcesWorkflowInput
> {
  return defineWorkflow(
    SyncIntegrationConnectionResourcesWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      return step.run({ name: "sync-integration-connection-resources" }, async () =>
        input.syncIntegrationConnectionResources(workflowInput),
      );
    },
  );
}
