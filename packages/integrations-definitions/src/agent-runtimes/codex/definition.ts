import { type AgentRuntimeDefinition } from "@mistle/integrations-core";

import { compileCodexRuntime } from "./compile-runtime.js";
import { createOpenAiConversationProvider } from "./conversation-provider.server.js";
import { createOpenAiExecutionObserver } from "./execution-observer.server.js";
import { CodexRuntimeConfigSchema } from "./runtime-config-schema.js";

export const CodexRuntimeDefinition: AgentRuntimeDefinition<typeof CodexRuntimeConfigSchema> = {
  runtimeId: "codex",
  displayName: "Codex",
  configSchema: CodexRuntimeConfigSchema,
  compileRuntime: compileCodexRuntime,
  createConversationProvider: createOpenAiConversationProvider,
  createExecutionObserver: createOpenAiExecutionObserver,
};
