import type { McpServerSourceCapability } from "./mcp-server-source.js";
import type { AgentProviderAccess } from "./model-access.js";

export type ConnectionCapabilitySet = {
  agentProviderAccess?: AgentProviderAccess | undefined;
  mcpServerSource?: McpServerSourceCapability | undefined;
  resourceSync?: unknown;
  webhookSource?: unknown;
};

export type { AgentProviderAccess } from "./model-access.js";
export type { McpServerSourceCapability } from "./mcp-server-source.js";
