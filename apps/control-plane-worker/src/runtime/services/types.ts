import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type {
  BoundAutomationConversation,
  ClaimAutomationConversationInput,
  ClaimedAutomationConversation,
  ControlPlaneWorkerServices,
  EnsureAutomationConversationBindingInput,
  EnsureAutomationConversationRouteInput,
  EnsureAutomationConversationSandboxInput,
  EnsuredAutomationConversationSandbox,
  ExecuteAutomationConversationInput,
  ExecutedAutomationConversation,
  HandleAutomationRunWorkflowInput,
  PersistAutomationConversationExecutionInput,
  PreparedAutomationRun,
  RoutedAutomationConversation,
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";

import type { ControlPlaneWorkerConfig } from "../../types.js";

export type CreateControlPlaneWorkerServicesInput = {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
  db: ControlPlaneDatabase;
  openWorkflow: ReturnType<typeof createControlPlaneOpenWorkflow>;
  dataPlaneSandboxInstancesClient: DataPlaneSandboxInstancesClient;
};

export type StartSandboxProfileInstanceServiceDependencies = {
  db: ControlPlaneDatabase;
  dataPlaneSandboxInstancesClient: Pick<DataPlaneSandboxInstancesClient, "startSandboxInstance">;
};

export type StartSandboxProfileInstanceServiceInput = StartSandboxProfileInstanceWorkflowInput;
export type StartSandboxProfileInstanceServiceOutput = StartSandboxProfileInstanceWorkflowOutput;

export type HandleAutomationRunServiceDependencies = {
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
    restoreFromSourceInstanceId?: string;
    sandboxInstanceId?: string;
  }) => Promise<{
    workflowRunId: string;
    sandboxInstanceId: string;
  }>;
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

export type HandleAutomationRunServiceInput = HandleAutomationRunWorkflowInput;
export type HandleAutomationRunTransitionServiceOutput = { shouldProcess: boolean };
export type PrepareAutomationRunServiceOutput = PreparedAutomationRun;
export type ClaimAutomationConversationServiceInput = ClaimAutomationConversationInput;
export type ClaimAutomationConversationServiceOutput = ClaimedAutomationConversation;
export type EnsureAutomationConversationSandboxServiceInput =
  EnsureAutomationConversationSandboxInput;
export type EnsureAutomationConversationSandboxServiceOutput = EnsuredAutomationConversationSandbox;
export type EnsureAutomationConversationRouteServiceInput = EnsureAutomationConversationRouteInput;
export type EnsureAutomationConversationRouteServiceOutput = RoutedAutomationConversation;
export type EnsureAutomationConversationBindingServiceInput =
  EnsureAutomationConversationBindingInput;
export type EnsureAutomationConversationBindingServiceOutput = BoundAutomationConversation;
export type ExecuteAutomationConversationServiceInput = ExecuteAutomationConversationInput;
export type ExecuteAutomationConversationServiceOutput = ExecutedAutomationConversation;
export type PersistAutomationConversationExecutionServiceInput =
  PersistAutomationConversationExecutionInput;
export type HandleAutomationRunMarkFailedServiceInput = {
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
};
export type HandleAutomationRunResolveFailureServiceInput = {
  error: unknown;
};
export type HandleAutomationRunResolveFailureServiceOutput = {
  code: string;
  message: string;
};

export type HandleIntegrationWebhookEventServiceDependencies = {
  db: ControlPlaneDatabase;
  enqueueAutomationRuns: (input: { automationRunIds: ReadonlyArray<string> }) => Promise<void>;
};

export type HandleIntegrationWebhookEventServiceInput = HandleIntegrationWebhookEventWorkflowInput;
export type HandleIntegrationWebhookEventServiceOutput =
  HandleIntegrationWebhookEventWorkflowOutput;

export type ControlPlaneWorkerRuntimeServices = ControlPlaneWorkerServices;
