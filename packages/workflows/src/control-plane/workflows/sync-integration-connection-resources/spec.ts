import { defineWorkflowSpec } from "openworkflow";

export type SyncIntegrationConnectionResourcesWorkflowInput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type SyncIntegrationConnectionResourcesWorkflowOutput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export const SyncIntegrationConnectionResourcesWorkflowSpec = defineWorkflowSpec<
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput
>({
  name: "control-plane.integration-connections.sync-resources",
  version: "1",
});
