import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import {
  HandleAutomationRunWorkflowSpec,
  HandleConversationDeliveryWorkflowSpec,
  type HandleConversationDeliveryWorkflowInput,
} from "@mistle/workflows/control-plane";

import { createEmailSender } from "./create-email-sender.js";
import { deleteSandboxProfile } from "./delete-sandbox-profile.js";
import {
  handoffAutomationRunDelivery,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  transitionAutomationRunToRunning,
} from "./handle-automation-run.js";
import {
  acquireConversationDeliveryConnection,
  claimOrResumeConversationDeliveryTask,
  completeConversationDeliveryAutomationRun,
  deliverConversationAutomationPayload,
  ensureConversationDeliverySandbox,
  failConversationDeliveryAutomationRun,
  finalizeConversationDeliveryActiveTask,
  idleConversationDeliveryProcessor,
  prepareConversationDeliveryAutomationRun,
  resolveAutomationRunFailure as resolveConversationDeliveryFailure,
} from "./handle-conversation-delivery.js";
import { handleIntegrationWebhookEvent } from "./handle-integration-webhook-event.js";
import { startSandboxProfileInstance } from "./start-sandbox-profile-instance.js";
import { syncIntegrationConnectionResources } from "./sync-integration-connection-resources.js";
import type {
  ControlPlaneWorkerRuntimeServices,
  CreateControlPlaneWorkerServicesInput,
} from "./types.js";

export function createControlPlaneWorkerServices(
  input: CreateControlPlaneWorkerServicesInput,
): ControlPlaneWorkerRuntimeServices {
  const emailSender = createEmailSender(input.config);
  const integrationRegistry = createIntegrationRegistry();
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
          },
          workflowInput,
        );
      },
      prepareAutomationRun: async (workflowInput) => {
        return prepareAutomationRun(
          {
            db: input.db,
          },
          workflowInput,
        );
      },
      handoffAutomationRunDelivery: async (workflowInput) => {
        return handoffAutomationRunDelivery(
          {
            db: input.db,
            enqueueConversationDeliveryWorkflow: async (enqueueInput) => {
              await input.openWorkflow.runWorkflow(
                HandleConversationDeliveryWorkflowSpec,
                {
                  conversationId: enqueueInput.conversationId,
                  generation: enqueueInput.generation,
                },
                {
                  idempotencyKey: `conversation-delivery:${enqueueInput.conversationId}:${String(enqueueInput.generation)}`,
                },
              );
            },
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
    conversationDelivery: {
      claimOrResumeConversationDeliveryTask: async (
        workflowInput: HandleConversationDeliveryWorkflowInput,
      ) => {
        return claimOrResumeConversationDeliveryTask(
          {
            db: input.db,
          },
          workflowInput,
        );
      },
      idleConversationDeliveryProcessorIfEmpty: async (
        workflowInput: HandleConversationDeliveryWorkflowInput,
      ) => {
        return idleConversationDeliveryProcessor(
          {
            db: input.db,
          },
          workflowInput,
        );
      },
      prepareAutomationRun: async ({ automationRunId }) => {
        return prepareConversationDeliveryAutomationRun(
          {
            db: input.db,
          },
          {
            automationRunId,
          },
        );
      },
      ensureAutomationSandbox: async ({ preparedAutomationRun }) => {
        return ensureConversationDeliverySandbox(
          {
            db: input.db,
            startSandboxProfileInstance: (startInput) =>
              controlPlaneInternalClient.startSandboxProfileInstance(startInput),
          },
          {
            preparedAutomationRun,
          },
        );
      },
      acquireAutomationConnection: async ({ preparedAutomationRun, ensuredAutomationSandbox }) => {
        return acquireConversationDeliveryConnection(
          {
            getSandboxInstance: (sandboxInput) =>
              controlPlaneInternalClient.getSandboxInstance(sandboxInput),
            mintSandboxConnectionToken: (mintInput) =>
              controlPlaneInternalClient.mintSandboxConnectionToken(mintInput),
          },
          {
            preparedAutomationRun,
            ensuredAutomationSandbox,
          },
        );
      },
      deliverAutomationPayload: async ({
        taskId,
        generation,
        preparedAutomationRun,
        ensuredAutomationSandbox,
        acquiredAutomationConnection,
      }) => {
        await deliverConversationAutomationPayload(
          {
            db: input.db,
          },
          {
            taskId,
            generation,
            preparedAutomationRun,
            ensuredAutomationSandbox,
            acquiredAutomationConnection,
          },
        );
      },
      markAutomationRunCompleted: async ({ automationRunId }) => {
        await completeConversationDeliveryAutomationRun(
          {
            db: input.db,
          },
          {
            automationRunId,
          },
        );
      },
      markAutomationRunFailed: async ({ automationRunId, failureCode, failureMessage }) => {
        await failConversationDeliveryAutomationRun(
          {
            db: input.db,
          },
          {
            automationRunId,
            failureCode,
            failureMessage,
          },
        );
      },
      finalizeConversationDeliveryTask: async ({
        taskId,
        generation,
        status,
        failureCode,
        failureMessage,
      }) => {
        await finalizeConversationDeliveryActiveTask(
          {
            db: input.db,
          },
          {
            taskId,
            generation,
            status,
            failureCode: failureCode ?? null,
            failureMessage: failureMessage ?? null,
          },
        );
      },
      resolveAutomationRunFailure: ({ error }) => {
        return resolveConversationDeliveryFailure(error);
      },
    },
    integrationWebhooks: {
      handleWebhookEvent: async (workflowInput) => {
        return handleIntegrationWebhookEvent(
          {
            db: input.db,
            integrationRegistry,
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
            enqueueResourceSync: async ({ organizationId, connectionId, kind }) => {
              await controlPlaneInternalClient.requestIntegrationConnectionResourceRefresh({
                organizationId,
                connectionId,
                kind,
              });
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
    integrationConnectionResources: {
      syncIntegrationConnectionResources: async (workflowInput) => {
        return syncIntegrationConnectionResources(
          {
            db: input.db,
            integrationRegistry,
            resolveIntegrationCredential: async (resolveInput) =>
              controlPlaneInternalClient.resolveIntegrationCredential(resolveInput),
            resolveIntegrationTargetSecrets: async (resolveInput) => {
              const resolvedSecrets =
                await controlPlaneInternalClient.resolveIntegrationTargetSecrets({
                  targets: [
                    {
                      targetKey: resolveInput.targetKey,
                      encryptedSecrets: resolveInput.encryptedSecrets,
                    },
                  ],
                });

              const resolvedTarget = resolvedSecrets.targets[0];
              if (resolvedTarget === undefined) {
                throw new Error(
                  `Resolved target secrets for '${resolveInput.targetKey}' were not returned.`,
                );
              }

              return {
                secrets: resolvedTarget.secrets,
              };
            },
          },
          workflowInput,
        );
      },
    },
  } satisfies ControlPlaneWorkerRuntimeServices;
}
