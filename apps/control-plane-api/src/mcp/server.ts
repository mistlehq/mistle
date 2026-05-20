import { readRepositoryVersion } from "@mistle/config";
import { McpServer } from "@modelcontextprotocol/server";

const MistleMcpServerVersion = readRepositoryVersion(import.meta.url);

export function createMistleMcpServer(): McpServer {
  return new McpServer({
    name: "mistle-control-plane",
    version: MistleMcpServerVersion,
  });
}
