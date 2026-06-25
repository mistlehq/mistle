import { readRepositoryVersion } from "@mistle/config";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { Clock } from "@mistle/time";
import { McpServer } from "@modelcontextprotocol/server";

import type { CreateSandboxProfilesServiceInput } from "../sandbox-profiles/services/types.js";
import type { AppOrganizationActor, ControlPlaneApiPortAccessConfig } from "../types.js";
import { registerCapabilityTools } from "./tools/capabilities.js";
import { registerIntegrationTools } from "./tools/integration.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerSandboxTools } from "./tools/sandbox.js";
import { registerTriggerTools } from "./tools/trigger.js";

const MistleMcpServerVersion = readRepositoryVersion(import.meta.url);

export type MistleMcpServerContext = {
  clock: Clock;
  controlPlaneBaseUrl: string;
  dashboardBaseUrl: string;
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  organizationActor: AppOrganizationActor;
  portAccessConfig: ControlPlaneApiPortAccessConfig;
} & Pick<
  CreateSandboxProfilesServiceInput,
  | "db"
  | "integrationRegistry"
  | "integrationsConfig"
  | "mcpConfig"
  | "openWorkflow"
  | "sandboxConfig"
>;

export function createMistleMcpServer(context: MistleMcpServerContext): McpServer {
  const server = new McpServer({
    name: "mistle-control-plane",
    version: MistleMcpServerVersion,
  });

  registerCapabilityTools(server, context);
  registerIntegrationTools(server, context);
  registerProfileTools(server, context);
  registerSandboxTools(server, context);
  registerTriggerTools(server, context);

  return server;
}
