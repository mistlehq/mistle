import type { createControlPlaneOpenWorkflow } from "@control-plane/workflows";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import type {
  RequestIntegrationConnectionResourceRefreshInput,
  RequestIntegrationConnectionResourceRefreshResult,
} from "./request-resource-refresh.js";

export type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

export type CreateIntegrationConnectionsServiceInput = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  openWorkflow: ControlPlaneOpenWorkflow;
};

export type IntegrationConnectionsService = {
  requestResourceRefresh: (
    input: RequestIntegrationConnectionResourceRefreshInput,
  ) => Promise<RequestIntegrationConnectionResourceRefreshResult>;
};
