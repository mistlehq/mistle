import type { Cache } from "@mistle/cache";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import type { createControlPlaneOpenWorkflow } from "../../openworkflow.js";
import type { ControlPlaneApiMcpConfig, ControlPlaneApiSandboxRuntimeConfig } from "../../types.js";

export type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

export type CreateSandboxProfilesServiceInput = {
  db: ControlPlaneDatabase;
  cache: Cache;
  integrationRegistry: IntegrationRegistry;
  sandboxConfig: ControlPlaneApiSandboxRuntimeConfig;
  openWorkflow: ControlPlaneOpenWorkflow;
  integrationsConfig: {
    activeMasterEncryptionKeyVersion: number;
    masterEncryptionKeys: Record<string, string>;
  };
  mcpConfig: ControlPlaneApiMcpConfig;
  dataPlaneClient: Pick<
    DataPlaneSandboxInstancesClient,
    "materializeSandboxProfileVersionSnapshotJob" | "startSandboxInstance"
  >;
};
