import { readRepositoryVersion } from "@mistle/config";
import { McpServer } from "@modelcontextprotocol/server";

import type { CreateSandboxProfilesServiceInput } from "../sandbox-profiles/services/types.js";
import type { AppOrganizationActor } from "../types.js";
import { registerProfileTools } from "./tools/profile.js";

const MistleMcpServerVersion = readRepositoryVersion(import.meta.url);

export type MistleMcpServerContext = {
  organizationActor: AppOrganizationActor;
} & Pick<CreateSandboxProfilesServiceInput, "db" | "integrationRegistry" | "sandboxConfig">;

export function createMistleMcpServer(context: MistleMcpServerContext): McpServer {
  const server = new McpServer({
    name: "mistle-control-plane",
    version: MistleMcpServerVersion,
  });

  registerProfileTools(server, context);

  return server;
}
