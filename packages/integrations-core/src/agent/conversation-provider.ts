import type { AgentConversationInspectResult } from "./types.js";

export type AgentConversationRequest = {
  method: string;
  params?: unknown;
};

export type AgentConversationConnection = {
  request(this: void, input: AgentConversationRequest): Promise<unknown>;
  close(this: void): Promise<void>;
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
  connect(this: void, input: AgentConversationConnectInput): Promise<AgentConversationConnection>;
  inspectConversation(
    this: void,
    input: AgentConversationInspectInput,
  ): Promise<AgentConversationInspectResult>;
  createConversation(
    this: void,
    input: AgentConversationCreateInput,
  ): Promise<AgentConversationCreateResult>;
  resumeConversation(this: void, input: AgentConversationResumeInput): Promise<void>;
  startExecution(
    this: void,
    input: AgentConversationStartExecutionInput,
  ): Promise<AgentConversationStartExecutionResult>;
  steerExecution?(
    this: void,
    input: AgentConversationSteerExecutionInput,
  ): Promise<AgentConversationSteerExecutionResult>;
  recoverLateSteer?(
    this: void,
    input: AgentConversationRecoverLateSteerInput,
  ): Promise<AgentConversationRecoverLateSteerResult>;
  interruptExecution?(this: void, input: AgentConversationInterruptExecutionInput): Promise<void>;
};
