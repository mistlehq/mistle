import { readRepositoryVersion } from "@mistle/config";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { McpServer } from "@modelcontextprotocol/server";

import type { AppOrganizationActor } from "../types.js";
import { registerProfileTools } from "./tools/profile.js";

const MistleMcpServerVersion = readRepositoryVersion(import.meta.url);

export type MistleMcpServerContext = {
  db: ControlPlaneDatabase;
  organizationActor: AppOrganizationActor;
};

export function createMistleMcpServer(context: MistleMcpServerContext): McpServer {
  const server = new McpServer({
    name: "mistle-control-plane",
    version: MistleMcpServerVersion,
  });

  registerProfileTools(server, context);

  return server;
}
