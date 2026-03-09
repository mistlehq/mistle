import type { EmailSender } from "@mistle/emails";
import type { OpenWorkflow, Worker } from "openworkflow";

import { createHandleAutomationRunWorkflow } from "./workflows/handle-automation-run/index.js";
import type {
  HandoffAutomationRunDeliveryInput,
  HandleAutomationRunWorkflowInput,
  PreparedAutomationRun,
} from "./workflows/handle-automation-run/index.js";
import {
  createHandleConversationDeliveryWorkflow,
  type ActiveConversationDeliveryTask,
  type AcquiredAutomationConnection,
  type ConversationDeliveryTaskAction,
  type EnsuredAutomationSandbox,
  type FinalConversationDeliveryTaskStatus,
  type HandleConversationDeliveryWorkflowInput,
} from "./workflows/handle-conversation-delivery/index.js";
import { createHandleIntegrationWebhookEventWorkflow } from "./workflows/handle-integration-webhook-event/index.js";
import type {
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
} from "./workflows/handle-integration-webhook-event/index.js";
import { createRequestDeleteSandboxProfileWorkflow } from "./workflows/request-delete-sandbox-profile/index.js";
import { createSendOrganizationInvitationWorkflow } from "./workflows/send-organization-invitation/index.js";
import { createSendVerificationOTPWorkflow } from "./workflows/send-verification-otp/index.js";
import { createStartSandboxProfileInstanceWorkflow } from "./workflows/start-sandbox-profile-instance/index.js";
import type {
  StartSandboxProfileInstanceWorkflowInput,
  StartSandboxProfileInstanceWorkflowOutput,
} from "./workflows/start-sandbox-profile-instance/index.js";
import { createSyncIntegrationConnectionResourcesWorkflow } from "./workflows/sync-integration-connection-resources/index.js";
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

export type ControlPlaneWorkerServices = {
  automationRuns?: {
    transitionAutomationRunToRunning: (
      input: HandleAutomationRunWorkflowInput,
    ) => Promise<{ shouldProcess: boolean }>;
    prepareAutomationRun: (
      input: HandleAutomationRunWorkflowInput,
    ) => Promise<PreparedAutomationRun>;
    handoffAutomationRunDelivery: (input: HandoffAutomationRunDeliveryInput) => Promise<void>;
    markAutomationRunFailed: (input: {
      automationRunId: string;
      failureCode: string;
      failureMessage: string;
    }) => Promise<void>;
    resolveAutomationRunFailure: (input: { error: unknown }) => { code: string; message: string };
  };
  conversationDelivery?: {
    claimOrResumeConversationDeliveryTask: (
      input: HandleConversationDeliveryWorkflowInput,
    ) => Promise<ActiveConversationDeliveryTask | null>;
    resolveConversationDeliveryTaskAction: (input: {
      taskId: string;
      generation: number;
    }) => Promise<ConversationDeliveryTaskAction>;
    idleConversationDeliveryProcessorIfEmpty: (
      input: HandleConversationDeliveryWorkflowInput,
    ) => Promise<boolean>;
    prepareAutomationRun: (input: { automationRunId: string }) => Promise<PreparedAutomationRun>;
    ensureAutomationSandbox: (input: {
      preparedAutomationRun: PreparedAutomationRun;
    }) => Promise<EnsuredAutomationSandbox>;
    acquireAutomationConnection: (input: {
      preparedAutomationRun: PreparedAutomationRun;
      ensuredAutomationSandbox: EnsuredAutomationSandbox;
    }) => Promise<AcquiredAutomationConnection>;
    deliverAutomationPayload: (input: {
      taskId: string;
      generation: number;
      preparedAutomationRun: PreparedAutomationRun;
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
    finalizeConversationDeliveryTask: (input: {
      taskId: string;
      generation: number;
      status: FinalConversationDeliveryTaskStatus;
      failureCode?: string | null;
      failureMessage?: string | null;
    }) => Promise<void>;
    resolveAutomationRunFailure: (input: { error: unknown }) => { code: string; message: string };
  };
  integrationWebhooks?: {
    handleWebhookEvent: (
      input: HandleIntegrationWebhookEventWorkflowInput,
    ) => Promise<HandleIntegrationWebhookEventWorkflowOutput>;
  };
  emailDelivery?: ControlPlaneWorkerEmailDelivery;
  sandboxProfiles?: {
    deleteSandboxProfile: (input: { organizationId: string; profileId: string }) => Promise<void>;
  };
  sandboxInstances?: {
    startSandboxProfileInstance: (
      input: StartSandboxProfileInstanceWorkflowInput,
    ) => Promise<StartSandboxProfileInstanceWorkflowOutput>;
  };
  integrationConnectionResources?: {
    syncIntegrationConnectionResources: (
      input: SyncIntegrationConnectionResourcesWorkflowInput,
    ) => Promise<SyncIntegrationConnectionResourcesWorkflowOutput>;
  };
};

export const ControlPlaneWorkerWorkflowIds = {
  HANDLE_AUTOMATION_RUN: "handleAutomationRun",
  HANDLE_CONVERSATION_DELIVERY: "handleConversationDelivery",
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
    if (workflowId === ControlPlaneWorkerWorkflowIds.HANDLE_AUTOMATION_RUN) {
      if (input.services.automationRuns === undefined) {
        throw new Error(
          "Control-plane automation runs service is required for handleAutomationRun workflow.",
        );
      }
      const workflow = createHandleAutomationRunWorkflow({
        transitionAutomationRunToRunning:
          input.services.automationRuns.transitionAutomationRunToRunning,
        prepareAutomationRun: input.services.automationRuns.prepareAutomationRun,
        handoffAutomationRunDelivery: input.services.automationRuns.handoffAutomationRunDelivery,
        markAutomationRunFailed: input.services.automationRuns.markAutomationRunFailed,
        resolveAutomationRunFailure: input.services.automationRuns.resolveAutomationRunFailure,
      });
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    if (workflowId === ControlPlaneWorkerWorkflowIds.HANDLE_CONVERSATION_DELIVERY) {
      if (input.services.conversationDelivery === undefined) {
        throw new Error(
          "Control-plane conversation delivery service is required for handleConversationDelivery workflow.",
        );
      }
      const workflow = createHandleConversationDeliveryWorkflow({
        claimOrResumeConversationDeliveryTask:
          input.services.conversationDelivery.claimOrResumeConversationDeliveryTask,
        resolveConversationDeliveryTaskAction:
          input.services.conversationDelivery.resolveConversationDeliveryTaskAction,
        idleConversationDeliveryProcessorIfEmpty:
          input.services.conversationDelivery.idleConversationDeliveryProcessorIfEmpty,
        prepareAutomationRun: input.services.conversationDelivery.prepareAutomationRun,
        ensureAutomationSandbox: input.services.conversationDelivery.ensureAutomationSandbox,
        acquireAutomationConnection:
          input.services.conversationDelivery.acquireAutomationConnection,
        deliverAutomationPayload: input.services.conversationDelivery.deliverAutomationPayload,
        markAutomationRunCompleted: input.services.conversationDelivery.markAutomationRunCompleted,
        markAutomationRunIgnored: input.services.conversationDelivery.markAutomationRunIgnored,
        markAutomationRunFailed: input.services.conversationDelivery.markAutomationRunFailed,
        finalizeConversationDeliveryTask:
          input.services.conversationDelivery.finalizeConversationDeliveryTask,
        resolveAutomationRunFailure:
          input.services.conversationDelivery.resolveAutomationRunFailure,
      });
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    if (workflowId === ControlPlaneWorkerWorkflowIds.HANDLE_INTEGRATION_WEBHOOK_EVENT) {
      if (input.services.integrationWebhooks === undefined) {
        throw new Error(
          "Control-plane integration webhooks service is required for handleIntegrationWebhookEvent workflow.",
        );
      }
      const workflow = createHandleIntegrationWebhookEventWorkflow({
        handleWebhookEvent: input.services.integrationWebhooks.handleWebhookEvent,
      });
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    if (workflowId === ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION) {
      if (input.services.emailDelivery === undefined) {
        throw new Error(
          "Control-plane email delivery service is required for sendOrganizationInvitation workflow.",
        );
      }
      const workflow = createSendOrganizationInvitationWorkflow(input.services.emailDelivery);
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    if (workflowId === ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP) {
      if (input.services.emailDelivery === undefined) {
        throw new Error(
          "Control-plane email delivery service is required for sendVerificationOTP workflow.",
        );
      }
      const workflow = createSendVerificationOTPWorkflow(input.services.emailDelivery);
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    if (workflowId === ControlPlaneWorkerWorkflowIds.REQUEST_DELETE_SANDBOX_PROFILE) {
      if (input.services.sandboxProfiles === undefined) {
        throw new Error(
          "Control-plane sandbox profiles service is required for requestDeleteSandboxProfile workflow.",
        );
      }
      const workflow = createRequestDeleteSandboxProfileWorkflow({
        deleteSandboxProfile: input.services.sandboxProfiles.deleteSandboxProfile,
      });
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    if (workflowId === ControlPlaneWorkerWorkflowIds.START_SANDBOX_PROFILE_INSTANCE) {
      if (input.services.sandboxInstances === undefined) {
        throw new Error(
          "Control-plane sandbox instances service is required for startSandboxProfileInstance workflow.",
        );
      }
      const workflow = createStartSandboxProfileInstanceWorkflow({
        startSandboxInstance: input.services.sandboxInstances.startSandboxProfileInstance,
      });
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    if (workflowId === ControlPlaneWorkerWorkflowIds.SYNC_INTEGRATION_CONNECTION_RESOURCES) {
      if (input.services.integrationConnectionResources === undefined) {
        throw new Error(
          "Control-plane integration connection resources service is required for syncIntegrationConnectionResources workflow.",
        );
      }
      const workflow = createSyncIntegrationConnectionResourcesWorkflow({
        syncIntegrationConnectionResources:
          input.services.integrationConnectionResources.syncIntegrationConnectionResources,
      });
      input.openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      continue;
    }

    return assertNever(workflowId);
  }

  return input.openWorkflow.newWorker({
    concurrency: input.maxConcurrentWorkflows,
  });
}
