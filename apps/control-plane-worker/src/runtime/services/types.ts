import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  createControlPlaneOpenWorkflow,
  type ControlPlaneWorkerServices,
  type EnqueuePreparedAutomationRunInput,
  type HandleAutomationRunWorkflowInput,
  type HandleConversationDeliveryWorkflowInput,
  type HandleConversationDeliveryWorkflowOutput,
  type HandleIntegrationWebhookEventWorkflowInput,
  type HandleIntegrationWebhookEventWorkflowOutput,
  type PreparedAutomationRun,
  type StartSandboxProfileInstanceWorkflowInput,
  type StartSandboxProfileInstanceWorkflowOutput,
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
  openWorkflow?: ReturnType<typeof createControlPlaneOpenWorkflow>;
};

export type HandleAutomationRunServiceInput = HandleAutomationRunWorkflowInput;
export type HandleAutomationRunTransitionServiceOutput = { shouldProcess: boolean };
export type PrepareAutomationRunServiceOutput = PreparedAutomationRun;
export type EnqueuePreparedAutomationRunServiceInput = EnqueuePreparedAutomationRunInput;
export type EnsureAutomationSandboxServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
};
export type EnsureAutomationSandboxServiceOutput = {
  sandboxInstanceId: string;
  startupWorkflowRunId: string;
};
export type AcquireAutomationConnectionServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsureAutomationSandboxServiceOutput;
};
export type AcquireAutomationConnectionServiceOutput = {
  instanceId: string;
  url: string;
  token: string;
  expiresAt: string;
};
export type DeliverAutomationPayloadServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsureAutomationSandboxServiceOutput;
  acquiredAutomationConnection: AcquireAutomationConnectionServiceOutput;
};
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

export type HandleConversationDeliveryServiceDependencies = {
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

export type HandleConversationDeliveryServiceInput = HandleConversationDeliveryWorkflowInput;
export type HandleConversationDeliveryServiceOutput = HandleConversationDeliveryWorkflowOutput;

export type HandleIntegrationWebhookEventServiceDependencies = {
  db: ControlPlaneDatabase;
  enqueueAutomationRuns: (input: { automationRunIds: ReadonlyArray<string> }) => Promise<void>;
};

export type HandleIntegrationWebhookEventServiceInput = HandleIntegrationWebhookEventWorkflowInput;
export type HandleIntegrationWebhookEventServiceOutput =
  HandleIntegrationWebhookEventWorkflowOutput;

export type ControlPlaneWorkerRuntimeServices = ControlPlaneWorkerServices;
