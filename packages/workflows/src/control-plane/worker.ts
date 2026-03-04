import type { EmailSender } from "@mistle/emails";
import type { OpenWorkflow, Worker } from "openworkflow";

import { createHandleAutomationRunWorkflow } from "./workflows/handle-automation-run/index.js";
import type {
  AcquireAutomationConnectionInput,
  DeliverAutomationPayloadInput,
  EnsuredAutomationSandbox,
  EnsureAutomationSandboxInput,
  HandleAutomationRunWorkflowInput,
  PreparedAutomationRun,
} from "./workflows/handle-automation-run/index.js";
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
    ensureAutomationSandbox: (
      input: EnsureAutomationSandboxInput,
    ) => Promise<EnsuredAutomationSandbox>;
    acquireAutomationConnection: (input: AcquireAutomationConnectionInput) => Promise<void>;
    deliverAutomationPayload: (input: DeliverAutomationPayloadInput) => Promise<void>;
    markAutomationRunCompleted: (input: HandleAutomationRunWorkflowInput) => Promise<void>;
    markAutomationRunFailed: (input: {
      automationRunId: string;
      failureCode: string;
      failureMessage: string;
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
};

export const ControlPlaneWorkerWorkflowIds = {
  HANDLE_AUTOMATION_RUN: "handleAutomationRun",
  HANDLE_INTEGRATION_WEBHOOK_EVENT: "handleIntegrationWebhookEvent",
  SEND_ORGANIZATION_INVITATION: "sendOrganizationInvitation",
  SEND_VERIFICATION_OTP: "sendVerificationOTP",
  REQUEST_DELETE_SANDBOX_PROFILE: "requestDeleteSandboxProfile",
  START_SANDBOX_PROFILE_INSTANCE: "startSandboxProfileInstance",
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
        ensureAutomationSandbox: input.services.automationRuns.ensureAutomationSandbox,
        acquireAutomationConnection: input.services.automationRuns.acquireAutomationConnection,
        deliverAutomationPayload: input.services.automationRuns.deliverAutomationPayload,
        markAutomationRunCompleted: input.services.automationRuns.markAutomationRunCompleted,
        markAutomationRunFailed: input.services.automationRuns.markAutomationRunFailed,
        resolveAutomationRunFailure: input.services.automationRuns.resolveAutomationRunFailure,
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

    return assertNever(workflowId);
  }

  return input.openWorkflow.newWorker({
    concurrency: input.maxConcurrentWorkflows,
  });
}
