import type { McpServerSourceCapability } from "./mcp-server-source.js";

export type ConnectionCapabilitySet = {
  mcpServerSource?: McpServerSourceCapability | undefined;
  resourceSync?: unknown;
  webhookSource?: unknown;
};

export type { McpServerSourceCapability } from "./mcp-server-source.js";
export {
  resolveOAuth2NextRefreshAtFromExpiresIn,
  type OAuth2ExpiresInValue,
} from "./oauth2-refresh-scheduling.js";
