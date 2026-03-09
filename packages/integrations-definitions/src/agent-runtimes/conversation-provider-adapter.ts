import type {
  AgentRuntimeConversationProviderFamily,
  IntegrationDefinitionLocator,
} from "@mistle/integrations-core";

export type ProviderConversationStatus = "idle" | "active" | "error";

export type ProviderInspectConversationOutput = {
  exists: boolean;
  status: ProviderConversationStatus;
  activeExecutionId: string | null;
};

export type ProviderCreateConversationOutput = {
  providerConversationId: string;
  providerState?: unknown;
};

export type ProviderStartExecutionOutput = {
  providerExecutionId: string | null;
  providerState?: unknown;
};

export type ProviderSteerExecutionOutput = {
  providerExecutionId: string;
  providerState?: unknown;
};

export type ProviderConnectInput = {
  connectionUrl: string;
  requestId?: string;
  connectTimeoutMs?: number;
};

export type ProviderConnection = {
  request: (input: { method: string; params?: unknown }) => Promise<unknown>;
  close: () => Promise<void>;
};

export type ProviderInspectConversationInput = {
  connection: ProviderConnection;
  providerConversationId: string;
};

export type ProviderCreateConversationInput = {
  connection: ProviderConnection;
  options?: Record<string, unknown>;
};

export type ProviderResumeConversationInput = {
  connection: ProviderConnection;
  providerConversationId: string;
};

export type ProviderStartExecutionInput = {
  connection: ProviderConnection;
  providerConversationId: string;
  inputText: string;
};

export type ProviderSteerExecutionInput = {
  connection: ProviderConnection;
  providerConversationId: string;
  providerExecutionId: string;
  inputText: string;
};

export type ProviderInterruptExecutionInput = {
  connection: ProviderConnection;
  providerConversationId: string;
  providerExecutionId: string;
};

export type ConversationProviderAdapter = {
  providerFamily: AgentRuntimeConversationProviderFamily;
  connect: (input: ProviderConnectInput) => Promise<ProviderConnection>;
  inspectConversation: (
    input: ProviderInspectConversationInput,
  ) => Promise<ProviderInspectConversationOutput>;
  createConversation: (
    input: ProviderCreateConversationInput,
  ) => Promise<ProviderCreateConversationOutput>;
  resumeConversation: (input: ProviderResumeConversationInput) => Promise<void>;
  startExecution: (input: ProviderStartExecutionInput) => Promise<ProviderStartExecutionOutput>;
  steerExecution?: (input: ProviderSteerExecutionInput) => Promise<ProviderSteerExecutionOutput>;
  interruptExecution?: (input: ProviderInterruptExecutionInput) => Promise<void>;
};

export type AgentRuntimeConversationCapability = {
  providerFamily: AgentRuntimeConversationProviderFamily;
  createAdapter: () => ConversationProviderAdapter;
};

export type AgentRuntimeRegistration = IntegrationDefinitionLocator & {
  runtimeKey: string;
  capabilities: {
    conversation?: AgentRuntimeConversationCapability;
  };
};
