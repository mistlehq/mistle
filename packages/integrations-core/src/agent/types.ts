import type { AgentConversationProvider } from "./conversation-provider.js";
import type { AgentExecutionObserver } from "./execution-observer.js";

export type AgentConversationStatus = "idle" | "active" | "error";

export const AgentConversationStatuses: {
  IDLE: AgentConversationStatus;
  ACTIVE: AgentConversationStatus;
  ERROR: AgentConversationStatus;
} = {
  IDLE: "idle",
  ACTIVE: "active",
  ERROR: "error",
};

export type AgentConversationInspectResult = {
  exists: boolean;
  status: AgentConversationStatus;
  activeExecutionId: string | null;
};

export type AgentExecutionLeaseKind = "agent_execution";

export const AgentExecutionLeaseKinds: {
  AGENT_EXECUTION: AgentExecutionLeaseKind;
} = {
  AGENT_EXECUTION: "agent_execution",
};

export type AgentExecutionLease = {
  leaseId: string;
  kind: AgentExecutionLeaseKind;
  source: string;
  externalExecutionId: string;
  metadata?: Readonly<Record<string, unknown>>;
};

export type AgentExecutionState = "active" | "terminal" | "missing";

export const AgentExecutionStates: {
  ACTIVE: AgentExecutionState;
  TERMINAL: AgentExecutionState;
  MISSING: AgentExecutionState;
} = {
  ACTIVE: "active",
  TERMINAL: "terminal",
  MISSING: "missing",
};

export type AgentExecutionObservationType = "none" | "active";

export const AgentExecutionObservationTypes: {
  NONE: AgentExecutionObservationType;
  ACTIVE: AgentExecutionObservationType;
} = {
  NONE: "none",
  ACTIVE: "active",
};

export type AgentExecutionObservation =
  | {
      type: "none";
    }
  | {
      type: "active";
      lease: AgentExecutionLease;
      poll(): Promise<AgentExecutionState>;
    };

export type AgentIntegrationHooks = {
  createConversationProvider?(): AgentConversationProvider;
  createExecutionObserver?(): AgentExecutionObserver;
};
