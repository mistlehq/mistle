import type {
  AutomationConversationCreatedByKind,
  AutomationConversationIntegrationFamilyId,
  AutomationConversationOwnerKind,
  ControlPlaneDatabase,
  ControlPlaneTransaction,
} from "@mistle/db/control-plane";

export type AutomationRunIdInput = {
  automationRunId: string;
};

export type HandleAutomationRunDependencies = {
  db: ControlPlaneDatabase;
};

export type PreparedAutomationRun = {
  automationRunId: string;
  automationRunCreatedAt: string;
  automationId: string;
  conversationId: string;
  automationTargetId: string;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  webhookEventId: string;
  webhookEventType: string;
  webhookProviderEventType: string;
  webhookExternalEventId: string;
  webhookExternalDeliveryId: string | null;
  webhookSourceOrderKey: string;
  webhookPayload: Record<string, unknown>;
  renderedInput: string;
  renderedConversationKey: string;
  renderedIdempotencyKey: string | null;
};

export type HandoffAutomationRunDeliveryInput = {
  preparedAutomationRun: PreparedAutomationRun;
};

export type HandoffAutomationRunDeliveryDependencies = {
  db: ControlPlaneDatabase;
  enqueueConversationDeliveryWorkflow: (input: {
    conversationId: string;
    generation: number;
  }) => Promise<void>;
};

export type MarkAutomationRunFailedInput = {
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
};

export type MarkAutomationRunIgnoredInput = {
  automationRunId: string;
};

export type EnsureAutomationSandboxDependencies = {
  db: ControlPlaneDatabase;
  startSandboxProfileInstance: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    startedBy: {
      kind: "user" | "system";
      id: string;
    };
    source: "dashboard" | "webhook";
  }) => Promise<{
    workflowRunId: string;
    sandboxInstanceId: string;
  }>;
};

export type EnsuredAutomationSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string | null;
};

export type AcquireAutomationConnectionDependencies = {
  getSandboxInstance: (input: { organizationId: string; instanceId: string }) => Promise<{
    id: string;
    status: "starting" | "running" | "stopped" | "failed";
    failureCode: string | null;
    failureMessage: string | null;
  }>;
  mintSandboxConnectionToken: (input: { organizationId: string; instanceId: string }) => Promise<{
    instanceId: string;
    url: string;
    token: string;
    expiresAt: string;
  }>;
};

export type AcquiredAutomationConnection = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};

export type TransitionAutomationRunToRunningOutput = {
  shouldProcess: boolean;
};

export type AutomationConversationPersistenceDependencies = {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
};

export type ClaimAutomationConversationInput = {
  organizationId: string;
  ownerKind: AutomationConversationOwnerKind;
  ownerId: string;
  createdByKind: AutomationConversationCreatedByKind;
  createdById: string;
  conversationKey?: string;
  sandboxProfileId: string;
  integrationFamilyId: AutomationConversationIntegrationFamilyId;
  title?: string | null;
  preview?: string | null;
};

export type EnqueueAutomationConversationDeliveryTaskInput = {
  conversationId: string;
  automationRunId: string;
  sourceWebhookEventId: string;
  sourceOrderKey: string;
};

export type EnsureAutomationConversationDeliveryProcessorInput = {
  conversationId: string;
};

export type EnsureAutomationConversationDeliveryProcessorOutput = {
  conversationId: string;
  generation: number;
  shouldStart: boolean;
};

export type SetAutomationConversationDeliveryProcessorIdleInput = {
  conversationId: string;
  generation: number;
};
