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
