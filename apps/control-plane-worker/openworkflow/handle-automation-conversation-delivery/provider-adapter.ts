import type { AgentConversationProvider } from "@mistle/integrations-core";
import { resolveAgentConversationProvider } from "@mistle/integrations-definitions/agent-runtimes/server";

export type ProviderAutomationConversationStatus = "idle" | "active" | "error";

export type ProviderInspectConversationOutput = {
  exists: boolean;
  status: ProviderAutomationConversationStatus;
  activeExecutionId: string | null;
};

export type ProviderConversationMetadata = {
  name: string | null;
  preview: string | null;
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

export type ProviderReadConversationMetadataInput = {
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

export type ProviderRecoverLateSteerInput = {
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
  connect: (input: ProviderConnectInput) => Promise<ProviderConnection>;
  inspectAutomationConversation: (
    input: ProviderInspectConversationInput,
  ) => Promise<ProviderInspectConversationOutput>;
  readConversationMetadata?: (
    input: ProviderReadConversationMetadataInput,
  ) => Promise<ProviderConversationMetadata>;
  createAutomationConversation: (
    input: ProviderCreateConversationInput,
  ) => Promise<ProviderCreateConversationOutput>;
  resumeAutomationConversation: (input: ProviderResumeConversationInput) => Promise<void>;
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
  const readConversationMetadata = provider.readConversationMetadata;

  return {
    connect: async (input) => await provider.connect(input),
    inspectAutomationConversation: async (input) => await provider.inspectConversation(input),
    ...(readConversationMetadata === undefined
      ? {}
      : {
          readConversationMetadata: async (input) => await readConversationMetadata(input),
        }),
    createAutomationConversation: async (input) => await provider.createConversation(input),
    resumeAutomationConversation: async (input) => await provider.resumeConversation(input),
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
