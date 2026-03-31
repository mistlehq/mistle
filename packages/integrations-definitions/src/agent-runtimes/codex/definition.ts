import {
  IntegrationMcpConfigFormats,
  type AgentRuntimeDefinition,
} from "@mistle/integrations-core";

import { compileCodexRuntime } from "./compile-runtime.js";
import { CodexRuntimeConfigSchema } from "./runtime-config-schema.js";

export const CodexRuntimeDefinition: AgentRuntimeDefinition<typeof CodexRuntimeConfigSchema> = {
  runtimeId: "codex",
  displayName: "Codex",
  configSchema: CodexRuntimeConfigSchema,
  compileRuntime: compileCodexRuntime,
  materializeMcpConfig: () => [
    {
      clientId: "codex-cli",
      fileId: "codex_config",
      format: IntegrationMcpConfigFormats.TOML,
      path: ["mcp_servers"],
    },
  ],
};
