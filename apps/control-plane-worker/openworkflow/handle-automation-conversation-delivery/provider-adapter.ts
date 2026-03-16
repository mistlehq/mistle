import type { AgentConversationProvider } from "@mistle/integrations-core";
import { createOpenAiCodexConversationProvider } from "@mistle/integrations-definitions/openai/agent";

export type ProviderAutomationConversationStatus = "idle" | "active" | "error";

export type ProviderInspectConversationOutput = {
  exists: boolean;
  status: ProviderAutomationConversationStatus;
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
  createAutomationConversation: (
    input: ProviderCreateConversationInput,
  ) => Promise<ProviderCreateConversationOutput>;
  resumeAutomationConversation: (input: ProviderResumeConversationInput) => Promise<void>;
  startExecution: (input: ProviderStartExecutionInput) => Promise<ProviderStartExecutionOutput>;
  steerExecution?: (input: ProviderSteerExecutionInput) => Promise<ProviderSteerExecutionOutput>;
  recoverLateSteer?: (
    input: ProviderRecoverLateSteerInput,
  ) => Promise<ProviderStartExecutionOutput>;
  interruptExecution?: (input: ProviderInterruptExecutionInput) => Promise<void>;
};

export function getConversationProviderAdapter(
  integrationFamilyId: string,
): ConversationProviderAdapter {
  switch (integrationFamilyId) {
    case "openai":
      return adaptConversationProvider(createOpenAiCodexConversationProvider());
  }

  throw new Error(`Unsupported conversation integration family '${integrationFamilyId}'.`);
}

function adaptConversationProvider(
  provider: AgentConversationProvider,
): ConversationProviderAdapter {
  const steerExecution = provider.steerExecution;
  const recoverLateSteer = provider.recoverLateSteer;
  const interruptExecution = provider.interruptExecution;

  return {
    connect: async (input) => await provider.connect(input),
    inspectAutomationConversation: async (input) => await provider.inspectConversation(input),
    createAutomationConversation: async (input) => await provider.createConversation(input),
    resumeAutomationConversation: async (input) => await provider.resumeConversation(input),
    startExecution: async (input) => await provider.startExecution(input),
    ...(steerExecution === undefined
      ? {}
      : {
          steerExecution: async (input) => await steerExecution(input),
        }),
    ...(recoverLateSteer === undefined
      ? {}
      : {
          recoverLateSteer: async (input) => await recoverLateSteer(input),
        }),
    ...(interruptExecution === undefined
      ? {}
      : {
          interruptExecution: async (input) => await interruptExecution(input),
        }),
  };
}
