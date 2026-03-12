import type { EmailSender } from "@mistle/emails";
import type {
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput,
  HandleAutomationRunWorkflowInput,
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
} from "@mistle/workflow-registry/control-plane";

export type HandleAutomationRunTransitionResult = {
  shouldProcess: boolean;
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

export type HandleAutomationRunFailure = {
  code: string;
  message: string;
};

export type MarkAutomationRunFailedInput = {
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
};

export type ActiveAutomationConversationDeliveryTaskStatus = "claimed" | "delivering";

export type ActiveAutomationConversationDeliveryTask = {
  taskId: string;
  automationRunId: string;
  status: ActiveAutomationConversationDeliveryTaskStatus;
};

export type EnsuredAutomationSandbox = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string | null;
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
  requestId: string;
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

export type ControlPlaneWorkerEmailDelivery = {
  emailSender: EmailSender;
  from: {
    email: string;
    name: string;
  };
};

export type ControlPlaneAutomationRunServices = {
  transitionAutomationRunToRunning: (
    input: HandleAutomationRunWorkflowInput,
  ) => Promise<HandleAutomationRunTransitionResult>;
  prepareAutomationRun: (input: HandleAutomationRunWorkflowInput) => Promise<PreparedAutomationRun>;
  handoffAutomationRunDelivery: (input: HandoffAutomationRunDeliveryInput) => Promise<void>;
  markAutomationRunFailed: (input: MarkAutomationRunFailedInput) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => HandleAutomationRunFailure;
};

export type ControlPlaneAutomationConversationDeliveryServices = {
  claimOrResumeAutomationConversationDeliveryTask: (
    input: HandleAutomationConversationDeliveryWorkflowInput,
  ) => Promise<ActiveAutomationConversationDeliveryTask | null>;
  resolveAutomationConversationDeliveryTaskAction: (input: {
    taskId: string;
    generation: number;
  }) => Promise<AutomationConversationDeliveryTaskAction>;
  idleAutomationConversationDeliveryProcessorIfEmpty: (
    input: HandleAutomationConversationDeliveryWorkflowInput,
  ) => Promise<boolean>;
  prepareAutomationRun: (input: { automationRunId: string }) => Promise<PreparedAutomationRun>;
  resolveAutomationConversationDeliveryRoute: (input: {
    conversationId: string;
  }) => Promise<ResolvedAutomationConversationDeliveryRoute>;
  ensureAutomationSandbox: (input: {
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  }) => Promise<EnsuredAutomationSandbox>;
  acquireAutomationConnection: (input: {
    preparedAutomationRun: PreparedAutomationRun;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
  }) => Promise<AcquiredAutomationConnection>;
  deliverAutomationPayload: (input: {
    taskId: string;
    generation: number;
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
    acquiredAutomationConnection: AcquiredAutomationConnection;
  }) => Promise<void>;
  markAutomationRunCompleted: (input: { automationRunId: string }) => Promise<void>;
  markAutomationRunIgnored: (input: { automationRunId: string }) => Promise<void>;
  markAutomationRunFailed: (input: MarkAutomationRunFailedInput) => Promise<void>;
  finalizeAutomationConversationDeliveryTask: (input: {
    taskId: string;
    generation: number;
    status: FinalAutomationConversationDeliveryTaskStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  }) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => HandleAutomationRunFailure;
};

export type ControlPlaneIntegrationWebhookServices = {
  handleWebhookEvent: (
    input: HandleIntegrationWebhookEventWorkflowInput,
  ) => Promise<HandleIntegrationWebhookEventWorkflowOutput>;
};

export type ControlPlaneSandboxProfileServices = {
  deleteSandboxProfile: (input: { organizationId: string; profileId: string }) => Promise<void>;
};

export type ControlPlaneSandboxInstanceServices = {
  startSandboxProfileInstance: (
    input: StartSandboxProfileInstanceWorkflowInput,
  ) => Promise<StartSandboxProfileInstanceWorkflowOutput>;
};

export type ControlPlaneIntegrationConnectionResourceServices = {
  syncIntegrationConnectionResources: (
    input: SyncIntegrationConnectionResourcesWorkflowInput,
  ) => Promise<SyncIntegrationConnectionResourcesWorkflowOutput>;
};

export type ControlPlaneWorkerServices = {
  automationRuns?: ControlPlaneAutomationRunServices;
  automationConversationDelivery?: ControlPlaneAutomationConversationDeliveryServices;
  integrationWebhooks?: ControlPlaneIntegrationWebhookServices;
  emailDelivery?: ControlPlaneWorkerEmailDelivery;
  sandboxProfiles?: ControlPlaneSandboxProfileServices;
  sandboxInstances?: ControlPlaneSandboxInstanceServices;
  integrationConnectionResources?: ControlPlaneIntegrationConnectionResourceServices;
};

export type ControlPlaneWorkerRuntimeServices = ControlPlaneWorkerServices;

export type {
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput,
  HandleAutomationRunWorkflowInput,
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
};
