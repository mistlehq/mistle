import { IntegrationMcpConfigFormats, type AgentRuntimeMetadata } from "@mistle/integrations-core";

import { OpenCodeRuntimeConfigSchema } from "./runtime-config-schema.js";

export const OpenCodeRuntimeMetadata: AgentRuntimeMetadata<typeof OpenCodeRuntimeConfigSchema> = {
  runtimeId: "opencode",
  displayName: "OpenCode",
  logoKey: "opencode",
  configSchema: OpenCodeRuntimeConfigSchema,
  capabilities: {
    associatedResourceDelivery: {
      supported: true,
    },
    conversationDelivery: {
      idempotencyFingerprintRuntimeKey: "opencode",
      createConversationRetryPolicy: "idempotent",
    },
  },
  materializeMcpConfig: () => [
    {
      clientId: "opencode-cli",
      fileId: "opencode_config",
      format: IntegrationMcpConfigFormats.JSON,
      path: ["mcp"],
    },
  ],
};
