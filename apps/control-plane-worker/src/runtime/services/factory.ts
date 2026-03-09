import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { HandleAutomationRunWorkflowSpec } from "@mistle/workflows/control-plane";

import { createEmailSender } from "./create-email-sender.js";
import { deleteSandboxProfile } from "./delete-sandbox-profile.js";
import {
  enqueuePreparedAutomationRun,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "./handle-automation-run.js";
import { handleConversationDelivery } from "./handle-conversation-delivery.js";
import { handleIntegrationWebhookEvent } from "./handle-integration-webhook-event.js";
import { startSandboxProfileInstance } from "./start-sandbox-profile-instance.js";
import type {
  ControlPlaneWorkerRuntimeServices,
  CreateControlPlaneWorkerServicesInput,
} from "./types.js";

export function createControlPlaneWorkerServices(
  input: CreateControlPlaneWorkerServicesInput,
): ControlPlaneWorkerRuntimeServices {
  const emailSender = createEmailSender(input.config);
  const controlPlaneInternalClient = new ControlPlaneInternalClient({
    baseUrl: input.config.controlPlaneApi.baseUrl,
    internalAuthServiceToken: input.internalAuthServiceToken,
  });

  return {
    automationRuns: {
      transitionAutomationRunToRunning: async (workflowInput) => {
        return transitionAutomationRunToRunning(
          {
            db: input.db,
            openWorkflow: input.openWorkflow,
          },
          workflowInput,
        );
      },
      prepareAutomationRun: async (workflowInput) => {
        return prepareAutomationRun(
          {
            db: input.db,
            openWorkflow: input.openWorkflow,
          },
          workflowInput,
        );
      },
      enqueuePreparedAutomationRun: async (workflowInput) => {
        await enqueuePreparedAutomationRun(
          {
            db: input.db,
            openWorkflow: input.openWorkflow,
          },
          workflowInput,
        );
      },
      markAutomationRunFailed: async (workflowInput) => {
        await markAutomationRunFailed(
          {
            db: input.db,
          },
          workflowInput,
        );
      },
      resolveAutomationRunFailure: ({ error }) => {
        return resolveAutomationRunFailure(error);
      },
    },
    conversationDeliveries: {
      handleConversationDelivery: async (workflowInput) => {
        return handleConversationDelivery(
          {
            db: input.db,
            startSandboxProfileInstance: (startInput) =>
              controlPlaneInternalClient.startSandboxProfileInstance(startInput),
            getSandboxInstance: (sandboxInput) =>
              controlPlaneInternalClient.getSandboxInstance(sandboxInput),
            mintSandboxConnectionToken: (mintInput) =>
              controlPlaneInternalClient.mintSandboxConnectionToken(mintInput),
          },
          workflowInput,
        );
      },
    },
    integrationWebhooks: {
      handleWebhookEvent: async (workflowInput) => {
        return handleIntegrationWebhookEvent(
          {
            db: input.db,
            enqueueAutomationRuns: async ({ automationRunIds }) => {
              for (const automationRunId of automationRunIds) {
                await input.openWorkflow.runWorkflow(
                  HandleAutomationRunWorkflowSpec,
                  {
                    automationRunId,
                  },
                  {
                    idempotencyKey: automationRunId,
                  },
                );
              }
            },
          },
          workflowInput,
        );
      },
    },
    emailDelivery: {
      emailSender,
      from: {
        email: input.config.email.fromAddress,
        name: input.config.email.fromName,
      },
    },
    sandboxProfiles: {
      deleteSandboxProfile: async (workflowInput) => {
        await deleteSandboxProfile(
          {
            db: input.db,
          },
          workflowInput,
        );
      },
    },
    sandboxInstances: {
      startSandboxProfileInstance: async (workflowInput) => {
        return startSandboxProfileInstance(
          {
            db: input.db,
            dataPlaneSandboxInstancesClient: input.dataPlaneSandboxInstancesClient,
          },
          workflowInput,
        );
      },
    },
  } satisfies ControlPlaneWorkerRuntimeServices;
}
