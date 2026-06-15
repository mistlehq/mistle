import type { AgentRuntimeMetadata } from "@mistle/integrations-core";

import { ClaudeCodeRuntimeConfigSchema } from "./runtime-config-schema.js";
import { ClaudeCodeRuntimeClientId, ClaudeCodeRuntimeId } from "./server.js";

export const ClaudeCodeRuntimeMetadata: AgentRuntimeMetadata<typeof ClaudeCodeRuntimeConfigSchema> =
  {
    runtimeId: ClaudeCodeRuntimeId,
    displayName: "Claude Code",
    logoKey: "anthropic",
    configSchema: ClaudeCodeRuntimeConfigSchema,
    capabilities: {
      associatedResourceDelivery: {
        supported: true,
      },
      conversationDelivery: {
        idempotencyFingerprintRuntimeKey: ClaudeCodeRuntimeId,
        createConversationRetryPolicy: "idempotent",
      },
    },
    composerCapabilities: [
      {
        kind: "contextMention",
        trigger: "@",
        source: "workspacePath",
        insertAs: "relativePathText",
        submitAs: "inlineText",
      },
    ],
    materializeMcpConfig: () => [
      {
        clientId: ClaudeCodeRuntimeClientId,
        fileId: "claude_code_mcp_config",
        format: "json",
        path: ["mcpServers"],
      },
    ],
  };
