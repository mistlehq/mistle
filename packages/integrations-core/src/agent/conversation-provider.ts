import type { AgentConversationInspectResult } from "./types.js";

export type AgentConversationRequest = {
  method: string;
  params?: unknown;
};

export type AgentConversationConnection = {
  request(input: AgentConversationRequest): Promise<unknown>;
  close(): Promise<void>;
};

export type AgentConversationConnectInput = {
  connectionUrl: string;
  connectTimeoutMs?: number;
};

export type AgentConversationCreateInput = {
  connection: AgentConversationConnection;
  options?: Readonly<Record<string, unknown>>;
};

export type AgentConversationCreateResult = {
  providerConversationId: string;
  providerState?: unknown;
};

export type AgentConversationResumeInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
};

export type AgentConversationInspectInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
};

export type AgentConversationStartExecutionInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
  inputText: string;
};

export type AgentConversationStartExecutionResult = {
  providerExecutionId: string | null;
  providerState?: unknown;
};

export type AgentConversationSteerExecutionInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
  providerExecutionId: string;
  inputText: string;
};

export type AgentConversationSteerExecutionResult = {
  providerExecutionId: string;
  providerState?: unknown;
};

export type AgentConversationRecoverLateSteerInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
  providerExecutionId: string;
  inputText: string;
};

export type AgentConversationRecoverLateSteerResult = {
  providerExecutionId: string | null;
  providerState?: unknown;
};

export type AgentConversationInterruptExecutionInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
  providerExecutionId: string;
};

export type AgentConversationProvider = {
  connect(input: AgentConversationConnectInput): Promise<AgentConversationConnection>;
  inspectConversation(
    input: AgentConversationInspectInput,
  ): Promise<AgentConversationInspectResult>;
  createConversation(input: AgentConversationCreateInput): Promise<AgentConversationCreateResult>;
  resumeConversation(input: AgentConversationResumeInput): Promise<void>;
  startExecution(
    input: AgentConversationStartExecutionInput,
  ): Promise<AgentConversationStartExecutionResult>;
  steerExecution?(
    input: AgentConversationSteerExecutionInput,
  ): Promise<AgentConversationSteerExecutionResult>;
  recoverLateSteer?(
    input: AgentConversationRecoverLateSteerInput,
  ): Promise<AgentConversationRecoverLateSteerResult>;
  interruptExecution?(input: AgentConversationInterruptExecutionInput): Promise<void>;
};
