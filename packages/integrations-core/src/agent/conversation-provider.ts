import type { AgentConversationInspectResult } from "./types.js";

export type AgentConversationRequest = {
  method: string;
  params?: unknown;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

export type AgentConversationNotification = {
  method: string;
  params?: unknown;
};

export type AgentConversationConnection = {
  request(this: void, input: AgentConversationRequest): Promise<unknown>;
  notify?(this: void, input: AgentConversationNotification): Promise<void>;
  close(this: void): Promise<void>;
};

export type AgentConversationConnectInput = {
  connectionUrl: string;
  connectTimeoutMs?: number;
};

export type AgentConversationCreateInput = {
  connection: AgentConversationConnection;
  cwd?: string;
  options?: Readonly<Record<string, unknown>>;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
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

export type AgentConversationReadMetadataInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
};

export type AgentConversationReadMetadataResult = {
  name: string | null;
  preview: string | null;
};

export type AgentConversationTranscriptTurn = {
  id: string;
  status: string | null;
  items: readonly unknown[];
};

export type AgentConversationReadTranscriptInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
};

export type AgentConversationReadTranscriptResult = {
  providerConversationId: string;
  name: string | null;
  preview: string | null;
  turns: readonly AgentConversationTranscriptTurn[];
};

export type AgentConversationGenerateTitleInput = {
  connectionUrl: string;
  providerConversationId: string;
  providerState?: unknown;
  inputText: string;
};

export type AgentConversationGenerateTitleResult = {
  title: string;
};

export type AgentConversationResolveOriginalInput = {
  connection: AgentConversationConnection;
  explicitProviderConversationId?: string | null;
};

export type AgentConversationResolveOriginalResult = {
  providerConversationId: string | null;
};

export type AgentConversationCollaborationModeSettings = {
  developerInstructions: string | null;
};

export type AgentConversationIdempotencyOperation = "createConversation" | "submitPayload";

export type AgentConversationIdempotencyMetadata = {
  key: string;
  operation: AgentConversationIdempotencyOperation;
  requestFingerprint: string;
};

export type AgentConversationStartExecutionInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
  inputText: string;
  collaborationModeSettings?: AgentConversationCollaborationModeSettings | undefined;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
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
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
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
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

export type AgentConversationRecoverLateSteerResult = {
  providerExecutionId: string | null;
  providerState?: unknown;
};

export type AgentConversationSubmitAssociatedResourceDeliveryInput = {
  connection: AgentConversationConnection;
  providerConversationId: string;
  inputText: string;
  idempotency?: AgentConversationIdempotencyMetadata | undefined;
};

export type AgentConversationSubmitAssociatedResourceDeliveryResult = {
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
  readConversationMetadata?(
    this: void,
    input: AgentConversationReadMetadataInput,
  ): Promise<AgentConversationReadMetadataResult>;
  readConversationTranscript?(
    this: void,
    input: AgentConversationReadTranscriptInput,
  ): Promise<AgentConversationReadTranscriptResult>;
  generateConversationTitle?(
    this: void,
    input: AgentConversationGenerateTitleInput,
  ): Promise<AgentConversationGenerateTitleResult>;
  resolveOriginalConversation?(
    this: void,
    input: AgentConversationResolveOriginalInput,
  ): Promise<AgentConversationResolveOriginalResult>;
  createConversation(
    this: void,
    input: AgentConversationCreateInput,
  ): Promise<AgentConversationCreateResult>;
  resumeConversation(this: void, input: AgentConversationResumeInput): Promise<void>;
  startExecution(
    this: void,
    input: AgentConversationStartExecutionInput,
  ): Promise<AgentConversationStartExecutionResult>;
  steerExecution(
    this: void,
    input: AgentConversationSteerExecutionInput,
  ): Promise<AgentConversationSteerExecutionResult>;
  recoverLateSteer?(
    this: void,
    input: AgentConversationRecoverLateSteerInput,
  ): Promise<AgentConversationRecoverLateSteerResult>;
  submitAssociatedResourceDelivery?(
    this: void,
    input: AgentConversationSubmitAssociatedResourceDeliveryInput,
  ): Promise<AgentConversationSubmitAssociatedResourceDeliveryResult>;
  interruptExecution(this: void, input: AgentConversationInterruptExecutionInput): Promise<void>;
};
