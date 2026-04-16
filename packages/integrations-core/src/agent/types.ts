export type AgentConversationStatus = "idle" | "not_loaded" | "active" | "error";

export const AgentConversationStatuses: {
  IDLE: AgentConversationStatus;
  NOT_LOADED: AgentConversationStatus;
  ACTIVE: AgentConversationStatus;
  ERROR: AgentConversationStatus;
} = {
  IDLE: "idle",
  NOT_LOADED: "not_loaded",
  ACTIVE: "active",
  ERROR: "error",
};

export type AgentConversationInspectResult = {
  exists: boolean;
  status: AgentConversationStatus;
  activeExecutionId: string | null;
};
