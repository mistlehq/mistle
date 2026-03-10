import type { EmailSender } from "@mistle/emails";
import type { OpenWorkflow, Worker } from "openworkflow";

import {
  registerControlPlaneAuthWorkflows,
  registerControlPlaneAutomationWorkflows,
  registerControlPlaneIntegrationWorkflows,
  registerControlPlaneSandboxWorkflows,
} from "./register/index.js";
import {
  type ActiveAutomationConversationDeliveryTask,
  type AcquiredAutomationConnection,
  type AutomationConversationDeliveryTaskAction,
  type EnsuredAutomationSandbox,
  type FinalAutomationConversationDeliveryTaskStatus,
  type HandleAutomationConversationDeliveryWorkflowInput,
  type ResolvedAutomationConversationDeliveryRoute,
} from "./workflows/handle-automation-conversation-delivery/index.js";
import type {
  HandoffAutomationRunDeliveryInput,
  HandleAutomationRunWorkflowInput,
  PreparedAutomationRun,
} from "./workflows/handle-automation-run/index.js";
import type {
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
} from "./workflows/handle-integration-webhook-event/index.js";
import type {
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
} from "./workflows/start-sandbox-profile-instance/index.js";
import type {
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
} from "./workflows/sync-integration-connection-resources/index.js";

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
  ) => Promise<{ shouldProcess: boolean }>;
  prepareAutomationRun: (input: HandleAutomationRunWorkflowInput) => Promise<PreparedAutomationRun>;
  handoffAutomationRunDelivery: (input: HandoffAutomationRunDeliveryInput) => Promise<void>;
  markAutomationRunFailed: (input: {
    automationRunId: string;
    failureCode: string;
    failureMessage: string;
  }) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => { code: string; message: string };
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
  markAutomationRunFailed: (input: {
    automationRunId: string;
    failureCode: string;
    failureMessage: string;
  }) => Promise<void>;
  finalizeAutomationConversationDeliveryTask: (input: {
    taskId: string;
    generation: number;
    status: FinalAutomationConversationDeliveryTaskStatus;
    failureCode?: string | null;
    failureMessage?: string | null;
  }) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => { code: string; message: string };
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

export const ControlPlaneWorkerWorkflowIds = {
  HANDLE_AUTOMATION_RUN: "handleAutomationRun",
  HANDLE_AUTOMATION_CONVERSATION_DELIVERY: "handleAutomationConversationDelivery",
  HANDLE_INTEGRATION_WEBHOOK_EVENT: "handleIntegrationWebhookEvent",
  SEND_ORGANIZATION_INVITATION: "sendOrganizationInvitation",
  SEND_VERIFICATION_OTP: "sendVerificationOTP",
  REQUEST_DELETE_SANDBOX_PROFILE: "requestDeleteSandboxProfile",
  START_SANDBOX_PROFILE_INSTANCE: "startSandboxProfileInstance",
  SYNC_INTEGRATION_CONNECTION_RESOURCES: "syncIntegrationConnectionResources",
} as const;

export type ControlPlaneWorkerWorkflowId =
  (typeof ControlPlaneWorkerWorkflowIds)[keyof typeof ControlPlaneWorkerWorkflowIds];

export type CreateControlPlaneWorkerInput = {
  openWorkflow: OpenWorkflow;
  maxConcurrentWorkflows: number;
  enabledWorkflows: ReadonlyArray<ControlPlaneWorkerWorkflowId>;
  services: ControlPlaneWorkerServices;
};

function assertNever(value: never): never {
  throw new Error(`Unsupported control-plane workflow id: ${String(value)}`);
}

/**
 * Creates a control-plane OpenWorkflow worker and registers enabled workflows.
 */
export function createControlPlaneWorker(input: CreateControlPlaneWorkerInput): Worker {
  for (const workflowId of input.enabledWorkflows) {
    switch (workflowId) {
      case ControlPlaneWorkerWorkflowIds.HANDLE_AUTOMATION_RUN:
      case ControlPlaneWorkerWorkflowIds.HANDLE_AUTOMATION_CONVERSATION_DELIVERY:
      case ControlPlaneWorkerWorkflowIds.HANDLE_INTEGRATION_WEBHOOK_EVENT:
      case ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION:
      case ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP:
      case ControlPlaneWorkerWorkflowIds.REQUEST_DELETE_SANDBOX_PROFILE:
      case ControlPlaneWorkerWorkflowIds.START_SANDBOX_PROFILE_INSTANCE:
      case ControlPlaneWorkerWorkflowIds.SYNC_INTEGRATION_CONNECTION_RESOURCES:
        continue;
    }

    return assertNever(workflowId);
  }

  registerControlPlaneAuthWorkflows({
    openWorkflow: input.openWorkflow,
    enabledWorkflows: input.enabledWorkflows,
    services: input.services,
  });
  registerControlPlaneAutomationWorkflows({
    openWorkflow: input.openWorkflow,
    enabledWorkflows: input.enabledWorkflows,
    services: input.services,
  });
  registerControlPlaneIntegrationWorkflows({
    openWorkflow: input.openWorkflow,
    enabledWorkflows: input.enabledWorkflows,
    services: input.services,
  });
  registerControlPlaneSandboxWorkflows({
    openWorkflow: input.openWorkflow,
    enabledWorkflows: input.enabledWorkflows,
    services: input.services,
  });

  return input.openWorkflow.newWorker({
    concurrency: input.maxConcurrentWorkflows,
  });
}
