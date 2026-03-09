export const AgentTransportKinds = {
  WEBSOCKET: "websocket",
} as const;

export type AgentTransportKind = (typeof AgentTransportKinds)[keyof typeof AgentTransportKinds];

export type AgentWebSocketTransport = {
  kind: typeof AgentTransportKinds.WEBSOCKET;
  url: string;
  connectTimeoutMs?: number;
  protocols?: readonly string[];
};

export type AgentTransport = AgentWebSocketTransport;

export type AgentRuntimeMetadata = {
  id: string;
  displayName: string;
};

export type AgentInputTextItem = {
  type: "text";
  text: string;
};

export type AgentInputItem = AgentInputTextItem;

export const AgentThreadStatuses = {
  ACTIVE: "active",
  ERROR: "error",
  IDLE: "idle",
} as const;

export type AgentThreadStatus = (typeof AgentThreadStatuses)[keyof typeof AgentThreadStatuses];

export type AgentThreadTurn = {
  id: string;
  status: string | null;
  items: readonly unknown[];
};

export type AgentThreadSummary = {
  id: string;
  name: string | null;
  preview: string | null;
  updatedAt: number | null;
  createdAt: number | null;
};

export type AgentThreadReadResult = {
  threadId: string;
  turns: readonly AgentThreadTurn[];
};

export type AgentStartThreadInput = {
  model?: string;
};

export type AgentStartThreadResult = {
  threadId: string;
};

export type AgentResumeThreadInput = {
  threadId: string;
};

export type AgentResumeThreadResult = {
  threadId: string;
};

export type AgentReadThreadInput = {
  threadId: string;
};

export type AgentStartTurnInput = {
  threadId: string;
  input: readonly AgentInputItem[];
};

export type AgentStartTurnResult = {
  turnId: string;
  status: string;
};

export type AgentSteerTurnInput = {
  threadId: string;
  turnId: string;
  input: readonly AgentInputItem[];
};

export type AgentSteerTurnResult = {
  turnId: string;
};

export interface AgentSession {
  readonly transport: AgentTransport;
  close(): Promise<void>;
  receive(): Promise<string>;
  send(message: string): Promise<void>;
}

export type AgentSessionConnectInput = {
  transport: AgentTransport;
};

export interface AgentSessionConnector {
  connect(input: AgentSessionConnectInput): Promise<AgentSession>;
}

export type AgentRuntimeConnectInput = {
  session: AgentSession;
};

export interface ConnectedAgentRuntime {
  readonly metadata: AgentRuntimeMetadata;
  close(): Promise<void>;
  readThread(input: AgentReadThreadInput): Promise<AgentThreadReadResult>;
  resumeThread(input: AgentResumeThreadInput): Promise<AgentResumeThreadResult>;
  startThread(input: AgentStartThreadInput): Promise<AgentStartThreadResult>;
  startTurn(input: AgentStartTurnInput): Promise<AgentStartTurnResult>;
  steerTurn(input: AgentSteerTurnInput): Promise<AgentSteerTurnResult>;
}

export interface AgentRuntime {
  readonly metadata: AgentRuntimeMetadata;
  connect(input: AgentRuntimeConnectInput): Promise<ConnectedAgentRuntime>;
}
