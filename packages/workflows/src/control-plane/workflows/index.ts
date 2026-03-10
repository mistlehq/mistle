import {
  createHandleAutomationConversationDeliveryWorkflow,
  type CreateHandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowSpec,
  type HandleAutomationConversationDeliveryWorkflowInput,
  type HandleAutomationConversationDeliveryWorkflowOutput,
} from "./handle-automation-conversation-delivery/index.js";
import {
  createHandleAutomationRunWorkflow,
  HandleAutomationRunWorkflowSpec,
  type CreateHandleAutomationRunWorkflowInput,
  type HandleAutomationRunWorkflowInput,
  type HandleAutomationRunWorkflowOutput,
} from "./handle-automation-run/index.js";
import {
  createHandleIntegrationWebhookEventWorkflow,
  HandleIntegrationWebhookEventWorkflowSpec,
  type CreateHandleIntegrationWebhookEventWorkflowInput,
  type HandleIntegrationWebhookEventWorkflowInput,
  type HandleIntegrationWebhookEventWorkflowOutput,
} from "./handle-integration-webhook-event/index.js";
import {
  createRequestDeleteSandboxProfileWorkflow,
  RequestDeleteSandboxProfileWorkflowSpec,
  type CreateRequestDeleteSandboxProfileWorkflowInput,
} from "./request-delete-sandbox-profile/index.js";
import {
  createSendOrganizationInvitationWorkflow,
  SendOrganizationInvitationWorkflowSpec,
  type CreateSendOrganizationInvitationWorkflowInput,
} from "./send-organization-invitation/index.js";
import {
  createSendVerificationOTPWorkflow,
  SendVerificationOTPWorkflowSpec,
  type CreateSendVerificationOTPWorkflowInput,
} from "./send-verification-otp/index.js";
import {
  createStartSandboxProfileInstanceWorkflow,
  StartSandboxProfileInstanceWorkflowSpec,
  type CreateStartSandboxProfileInstanceWorkflowInput,
} from "./start-sandbox-profile-instance/index.js";
import {
  createSyncIntegrationConnectionResourcesWorkflow,
  SyncIntegrationConnectionResourcesWorkflowSpec,
  type CreateSyncIntegrationConnectionResourcesWorkflowInput,
  type SyncIntegrationConnectionResourcesWorkflowInput,
  type SyncIntegrationConnectionResourcesWorkflowOutput,
} from "./sync-integration-connection-resources/index.js";

/**
 * Control-plane workflow implementations.
 */
export type ControlPlaneWorkflowDefinition =
  | ReturnType<typeof createHandleAutomationRunWorkflow>
  | ReturnType<typeof createHandleAutomationConversationDeliveryWorkflow>
  | ReturnType<typeof createHandleIntegrationWebhookEventWorkflow>
  | ReturnType<typeof createSendOrganizationInvitationWorkflow>
  | ReturnType<typeof createSendVerificationOTPWorkflow>
  | ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>
  | ReturnType<typeof createStartSandboxProfileInstanceWorkflow>
  | ReturnType<typeof createSyncIntegrationConnectionResourcesWorkflow>;

export type ControlPlaneWorkflowDefinitions = {
  handleAutomationRun: ReturnType<typeof createHandleAutomationRunWorkflow>;
  handleAutomationConversationDelivery: ReturnType<
    typeof createHandleAutomationConversationDeliveryWorkflow
  >;
  handleIntegrationWebhookEvent: ReturnType<typeof createHandleIntegrationWebhookEventWorkflow>;
  sendOrganizationInvitation: ReturnType<typeof createSendOrganizationInvitationWorkflow>;
  sendVerificationOTP: ReturnType<typeof createSendVerificationOTPWorkflow>;
  requestDeleteSandboxProfile: ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>;
  startSandboxProfileInstance: ReturnType<typeof createStartSandboxProfileInstanceWorkflow>;
  syncIntegrationConnectionResources: ReturnType<
    typeof createSyncIntegrationConnectionResourcesWorkflow
  >;
};

export type CreateControlPlaneWorkflowDefinitionsInput = {
  handleAutomationRun: CreateHandleAutomationRunWorkflowInput;
  handleAutomationConversationDelivery: CreateHandleAutomationConversationDeliveryWorkflowInput;
  handleIntegrationWebhookEvent: CreateHandleIntegrationWebhookEventWorkflowInput;
  sendOrganizationInvitation: CreateSendOrganizationInvitationWorkflowInput;
  sendVerificationOTP: CreateSendVerificationOTPWorkflowInput;
  requestDeleteSandboxProfile: CreateRequestDeleteSandboxProfileWorkflowInput;
  startSandboxProfileInstance: CreateStartSandboxProfileInstanceWorkflowInput;
  syncIntegrationConnectionResources: CreateSyncIntegrationConnectionResourcesWorkflowInput;
};

export function createControlPlaneWorkflowDefinitions(
  ctx: CreateControlPlaneWorkflowDefinitionsInput,
): ControlPlaneWorkflowDefinitions {
  return {
    handleAutomationRun: createHandleAutomationRunWorkflow(ctx.handleAutomationRun),
    handleAutomationConversationDelivery: createHandleAutomationConversationDeliveryWorkflow(
      ctx.handleAutomationConversationDelivery,
    ),
    handleIntegrationWebhookEvent: createHandleIntegrationWebhookEventWorkflow(
      ctx.handleIntegrationWebhookEvent,
    ),
    sendOrganizationInvitation: createSendOrganizationInvitationWorkflow(
      ctx.sendOrganizationInvitation,
    ),
    sendVerificationOTP: createSendVerificationOTPWorkflow(ctx.sendVerificationOTP),
    requestDeleteSandboxProfile: createRequestDeleteSandboxProfileWorkflow(
      ctx.requestDeleteSandboxProfile,
    ),
    startSandboxProfileInstance: createStartSandboxProfileInstanceWorkflow(
      ctx.startSandboxProfileInstance,
    ),
    syncIntegrationConnectionResources: createSyncIntegrationConnectionResourcesWorkflow(
      ctx.syncIntegrationConnectionResources,
    ),
  };
}

export { HandleAutomationRunWorkflowSpec };
export type { HandleAutomationRunWorkflowInput, HandleAutomationRunWorkflowOutput };
export { HandleAutomationConversationDeliveryWorkflowSpec };
export type {
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput,
};
export { HandleIntegrationWebhookEventWorkflowSpec };
export type {
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
};
export { SendOrganizationInvitationWorkflowSpec };
export { SendVerificationOTPWorkflowSpec };
export { RequestDeleteSandboxProfileWorkflowSpec };
export { StartSandboxProfileInstanceWorkflowSpec };
export { SyncIntegrationConnectionResourcesWorkflowSpec };
export type {
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
};
