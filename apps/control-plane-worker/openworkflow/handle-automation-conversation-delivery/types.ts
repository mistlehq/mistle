export type ActiveAutomationConversationDeliveryTaskStatus = "claimed" | "delivering";

export type ActiveAutomationConversationDeliveryTask = {
  taskId: string;
  automationRunId: string;
  status: ActiveAutomationConversationDeliveryTaskStatus;
};

export type ResolvedAutomationConversationDeliveryRoute = {
  conversationId: string;
  integrationFamilyId: string;
  routeId: string | null;
  sandboxInstanceId: string | null;
  providerConversationId: string | null;
  providerExecutionId: string | null;
  providerState: unknown;
};

export type AcquiredAutomationConnection = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type FinalAutomationConversationDeliveryTaskStatus = "completed" | "failed" | "ignored";

export type AutomationConversationDeliveryTaskAction = "deliver" | "ignore";

export type ExecuteConversationProviderDeliveryInput = {
  conversationId: string;
  integrationFamilyId: string;
  connectionUrl: string;
  inputText: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
};

export type ExecutedConversationProviderDelivery = {
  providerConversationId: string;
  providerExecutionId: string | null;
  providerState?: unknown;
};
