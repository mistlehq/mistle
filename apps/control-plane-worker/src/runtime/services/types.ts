import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import type { createControlPlaneOpenWorkflow } from "../../openworkflow/client.js";
import type { ControlPlaneWorkerConfig } from "../../types.js";
import type {
  ActiveAutomationConversationDeliveryTask,
  AcquiredAutomationConnection,
  AutomationConversationDeliveryTaskAction,
  EnsuredAutomationSandbox,
  FinalAutomationConversationDeliveryTaskStatus,
  HandoffAutomationRunDeliveryInput,
  HandleAutomationRunWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput,
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
  PreparedAutomationRun,
  ResolvedAutomationConversationDeliveryRoute,
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
  ControlPlaneWorkerServices,
} from "../workflow-types.js";

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
  enqueueConversationDeliveryWorkflow: (input: {
    conversationId: string;
    generation: number;
  }) => Promise<void>;
};

export type HandleAutomationRunServiceInput = HandleAutomationRunWorkflowInput;
export type HandleAutomationRunTransitionServiceOutput = { shouldProcess: boolean };
export type PrepareAutomationRunServiceOutput = PreparedAutomationRun;
export type HandoffAutomationRunDeliveryServiceInput = HandoffAutomationRunDeliveryInput;
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

export type HandleAutomationConversationDeliveryServiceInput =
  HandleAutomationConversationDeliveryWorkflowInput;
export type HandleAutomationConversationDeliveryServiceOutput =
  HandleAutomationConversationDeliveryWorkflowOutput;
export type ClaimOrResumeAutomationConversationDeliveryTaskServiceOutput =
  ActiveAutomationConversationDeliveryTask | null;
export type ResolveAutomationConversationDeliveryTaskActionServiceOutput =
  AutomationConversationDeliveryTaskAction;
export type ResolveAutomationConversationDeliveryRouteServiceOutput =
  ResolvedAutomationConversationDeliveryRoute;
export type FinalizeAutomationConversationDeliveryTaskServiceInput = {
  taskId: string;
  generation: number;
  status: FinalAutomationConversationDeliveryTaskStatus;
  failureCode?: string | null;
  failureMessage?: string | null;
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

export type EnsureAutomationSandboxServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
};

export type EnsureAutomationSandboxServiceOutput = EnsuredAutomationSandbox;
export type EnsureAutomationConversationDeliverySandboxServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
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

export type AcquireAutomationConnectionServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsureAutomationSandboxServiceOutput;
};

export type AcquireAutomationConnectionServiceOutput = AcquiredAutomationConnection;

export type DeliverAutomationPayloadServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsureAutomationSandboxServiceOutput;
  acquiredAutomationConnection: AcquireAutomationConnectionServiceOutput;
};
export type DeliverAutomationConversationPayloadServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  ensuredAutomationSandbox: EnsureAutomationSandboxServiceOutput;
  acquiredAutomationConnection: AcquireAutomationConnectionServiceOutput;
};

export type HandleIntegrationWebhookEventServiceDependencies = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  enqueueAutomationRuns: (input: { automationRunIds: ReadonlyArray<string> }) => Promise<void>;
  enqueueResourceSync: (input: {
    organizationId: string;
    connectionId: string;
    kind: string;
  }) => Promise<void>;
};

export type HandleIntegrationWebhookEventServiceInput = HandleIntegrationWebhookEventWorkflowInput;
export type HandleIntegrationWebhookEventServiceOutput =
  HandleIntegrationWebhookEventWorkflowOutput;

export type ResolveResourceSyncCredentialInput = {
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

export type ResolveResourceSyncCredentialOutput = {
  value: string;
  expiresAt?: string;
};

export type ResolveResourceSyncTargetSecretsInput = {
  targetKey: string;
  encryptedSecrets: {
    ciphertext: string;
    nonce: string;
    masterKeyVersion: number;
  } | null;
};

export type ResolveResourceSyncTargetSecretsOutput = {
  secrets: Record<string, string>;
};

export type SyncIntegrationConnectionResourcesServiceDependencies = {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  resolveIntegrationCredential?: (
    input: ResolveResourceSyncCredentialInput,
  ) => Promise<ResolveResourceSyncCredentialOutput>;
  resolveIntegrationTargetSecrets?: (
    input: ResolveResourceSyncTargetSecretsInput,
  ) => Promise<ResolveResourceSyncTargetSecretsOutput>;
};

export type SyncIntegrationConnectionResourcesServiceInput =
  SyncIntegrationConnectionResourcesWorkflowInput;
export type SyncIntegrationConnectionResourcesServiceOutput =
  SyncIntegrationConnectionResourcesWorkflowOutput;

export type ControlPlaneWorkerRuntimeServices = ControlPlaneWorkerServices;
