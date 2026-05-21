import { readRepositoryVersion } from "@mistle/config";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { McpServer } from "@modelcontextprotocol/server";

import type { CreateSandboxProfilesServiceInput } from "../sandbox-profiles/services/types.js";
import type { AppOrganizationActor } from "../types.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerSandboxTools } from "./tools/sandbox.js";

const MistleMcpServerVersion = readRepositoryVersion(import.meta.url);

export type MistleMcpServerContext = {
  dataPlaneClient: DataPlaneSandboxInstancesClient;
  organizationActor: AppOrganizationActor;
} & Pick<
  CreateSandboxProfilesServiceInput,
  "db" | "integrationRegistry" | "integrationsConfig" | "mcpConfig" | "sandboxConfig"
>;

export function createMistleMcpServer(context: MistleMcpServerContext): McpServer {
  const server = new McpServer({
    name: "mistle-control-plane",
    version: MistleMcpServerVersion,
  });

  registerProfileTools(server, context);
  registerSandboxTools(server, context);

  return server;
}
