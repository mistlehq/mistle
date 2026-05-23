import type {
  AgentConversationCollaborationModeSettings,
  AgentConversationIdempotencyMetadata,
  AgentConversationProvider,
} from "@mistle/integrations-core";
import { resolveAgentConversationProvider } from "@mistle/integrations-definitions/agent-runtimes/server";

export type ProviderTriggerConversationStatus = "idle" | "not_loaded" | "active" | "error";

export type ProviderInspectConversationOutput = {
  exists: boolean;
  status: ProviderTriggerConversationStatus;
  activeExecutionId: string | null;
};

export type ProviderCreateConversationOutput = {
  providerConversationId: string;
  providerState?: unknown;
};

export type ProviderGenerateConversationTitleOutput = {
  title: string;
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
  connectTimeoutMs?: number;
};

export type ProviderConnection = {
  request: (input: {
    method: string;
    params?: unknown;
    idempotency?: AgentConversationIdempotencyMetadata | undefined;
  }) => Promise<unknown>;
  notify?: (input: { method: string; params?: unknown }) => Promise<void>;
  close: () => Promise<void>;
};

export type ProviderInspectConversationInput = {
  connection: ProviderConnection;
  providerConversationId: string;
};

export type ProviderCreateConversationInput = {
  connection: ProviderConnection;
  cwd?: string;
  options?: Record<string, unknown>;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

export type ProviderGenerateConversationTitleInput = {
  connectionUrl: string;
  providerConversationId: string;
  providerState?: unknown;
  inputText: string;
};

export type ProviderResumeConversationInput = {
  connection: ProviderConnection;
  providerConversationId: string;
};

export type ProviderStartExecutionInput = {
  connection: ProviderConnection;
  providerConversationId: string;
  inputText: string;
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

export type ProviderSteerExecutionInput = {
  connection: ProviderConnection;
  providerConversationId: string;
  providerExecutionId: string;
  inputText: string;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

export type ProviderRecoverLateSteerInput = {
  connection: ProviderConnection;
  providerConversationId: string;
  providerExecutionId: string;
  inputText: string;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

export type ProviderInterruptExecutionInput = {
  connection: ProviderConnection;
  providerConversationId: string;
  providerExecutionId: string;
};

export type ConversationProviderAdapter = {
  connect: (input: ProviderConnectInput) => Promise<ProviderConnection>;
  inspectTriggerConversation: (
    input: ProviderInspectConversationInput,
  ) => Promise<ProviderInspectConversationOutput>;
  createTriggerConversation: (
    input: ProviderCreateConversationInput,
  ) => Promise<ProviderCreateConversationOutput>;
  generateConversationTitle?: (
    input: ProviderGenerateConversationTitleInput,
  ) => Promise<ProviderGenerateConversationTitleOutput>;
  resumeTriggerConversation: (input: ProviderResumeConversationInput) => Promise<void>;
  startExecution: (input: ProviderStartExecutionInput) => Promise<ProviderStartExecutionOutput>;
  steerExecution: (input: ProviderSteerExecutionInput) => Promise<ProviderSteerExecutionOutput>;
  recoverLateSteer?: (
    input: ProviderRecoverLateSteerInput,
  ) => Promise<ProviderStartExecutionOutput>;
  interruptExecution: (input: ProviderInterruptExecutionInput) => Promise<void>;
};

export function getConversationProviderAdapter(runtimeId: string): ConversationProviderAdapter {
  return adaptConversationProvider(resolveAgentConversationProvider(runtimeId));
}

function adaptConversationProvider(
  provider: AgentConversationProvider,
): ConversationProviderAdapter {
  const recoverLateSteer = provider.recoverLateSteer;
  const generateConversationTitle = provider.generateConversationTitle;

  return {
    connect: async (input) => await provider.connect(input),
    inspectTriggerConversation: async (input) => await provider.inspectConversation(input),
    createTriggerConversation: async (input) => await provider.createConversation(input),
    ...(generateConversationTitle === undefined
      ? {}
      : {
          generateConversationTitle: async (input) => await generateConversationTitle(input),
        }),
    resumeTriggerConversation: async (input) => await provider.resumeConversation(input),
    startExecution: async (input) => await provider.startExecution(input),
    steerExecution: async (input) => await provider.steerExecution(input),
    ...(recoverLateSteer === undefined
      ? {}
      : {
          recoverLateSteer: async (input) => await recoverLateSteer(input),
        }),
    interruptExecution: async (input) => await provider.interruptExecution(input),
  };
}
