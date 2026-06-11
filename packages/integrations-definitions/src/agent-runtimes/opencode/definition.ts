import {
  IntegrationMcpConfigFormats,
  type AgentRuntimeDefinition,
} from "@mistle/integrations-core";

import { compileOpenCodeRuntime } from "./compile-runtime.js";
import { OpenCodeRuntimeConfigSchema } from "./runtime-config-schema.js";

export const OpenCodeRuntimeDefinition: AgentRuntimeDefinition<typeof OpenCodeRuntimeConfigSchema> =
  {
    runtimeId: "opencode",
    displayName: "OpenCode",
    logoKey: "opencode",
    configSchema: OpenCodeRuntimeConfigSchema,
    capabilities: {
      associatedResourceDelivery: {
        supported: true,
      },
    },
    compileRuntime: compileOpenCodeRuntime,
    materializeMcpConfig: () => [
      {
        clientId: "opencode-cli",
        fileId: "opencode_config",
        format: IntegrationMcpConfigFormats.JSON,
        path: ["mcp"],
      },
    ],
  };
