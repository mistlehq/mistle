import { OpenAiDefaultAgentRuntimes } from "../openai/variants/openai-default/agent-runtime.js";
import type { AgentRuntimeRegistration } from "./conversation-provider-adapter.js";
import { AgentRuntimeRegistry } from "./registry.js";

export {
  ConversationProviderError,
  ConversationProviderErrorCodes,
  type ConversationProviderErrorCode,
} from "./conversation-provider-errors.js";
export type {
  AgentRuntimeConversationCapability,
  AgentRuntimeRegistration,
  ConversationProviderAdapter,
  ProviderConnection,
  ProviderConnectInput,
  ProviderCreateConversationInput,
  ProviderCreateConversationOutput,
  ProviderInspectConversationInput,
  ProviderInspectConversationOutput,
  ProviderInterruptExecutionInput,
  ProviderResumeConversationInput,
  ProviderStartExecutionInput,
  ProviderStartExecutionOutput,
  ProviderSteerExecutionInput,
  ProviderSteerExecutionOutput,
} from "./conversation-provider-adapter.js";
export {
  AgentRuntimeRegistry,
  AgentRuntimeRegistryError,
  AgentRuntimeRegistryErrorCodes,
  type AgentRuntimeLocator,
  type AgentRuntimeRegistryErrorCode,
} from "./registry.js";
export { connectSandboxAgentConnection } from "./sandbox-agent-connection.js";
export {
  OpenAiDefaultAgentRuntimes,
  createCodexConversationProviderAdapter,
} from "../openai/variants/openai-default/agent-runtime.js";

const RegisteredAgentRuntimes: ReadonlyArray<AgentRuntimeRegistration> = [
  ...OpenAiDefaultAgentRuntimes,
];

export function listAgentRuntimes(): ReadonlyArray<AgentRuntimeRegistration> {
  return RegisteredAgentRuntimes;
}

export function createAgentRuntimeRegistry(): AgentRuntimeRegistry {
  const registry = new AgentRuntimeRegistry();
  registry.registerMany(RegisteredAgentRuntimes);
  return registry;
}
