import { IntegrationMcpConfigFormats, type AgentRuntimeMetadata } from "@mistle/integrations-core";

import { CodexComposerCapabilities } from "./composer-capabilities.js";
import { CodexRuntimeConfigSchema } from "./runtime-config-schema.js";

export const CodexRuntimeMetadata: AgentRuntimeMetadata<typeof CodexRuntimeConfigSchema> = {
  runtimeId: "codex",
  displayName: "Codex",
  logoKey: "openai",
  configSchema: CodexRuntimeConfigSchema,
  capabilities: {
    associatedResourceDelivery: {
      supported: true,
    },
    conversationDelivery: {
      idempotencyFingerprintRuntimeKey: "codex",
      createConversationRetryPolicy: "idempotent",
    },
  },
  composerCapabilities: CodexComposerCapabilities,
  materializeMcpConfig: () => [
    {
      clientId: "codex-cli",
      fileId: "codex_config",
      format: IntegrationMcpConfigFormats.TOML,
      path: ["mcp_servers"],
    },
  ],
};
