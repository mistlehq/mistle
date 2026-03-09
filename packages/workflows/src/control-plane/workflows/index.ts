import {
  createHandleAutomationRunWorkflow,
  HandleAutomationRunWorkflowSpec,
  type CreateHandleAutomationRunWorkflowInput,
  type HandleAutomationRunWorkflowInput,
  type HandleAutomationRunWorkflowOutput,
} from "./handle-automation-run/index.js";
import {
  createHandleConversationDeliveryWorkflow,
  HandleConversationDeliveryWorkflowSpec,
  type CreateHandleConversationDeliveryWorkflowInput,
  type HandleConversationDeliveryWorkflowInput,
  type HandleConversationDeliveryWorkflowOutput,
} from "./handle-conversation-delivery/index.js";
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

/**
 * Control-plane workflow implementations.
 */
export type ControlPlaneWorkflowDefinition =
  | ReturnType<typeof createHandleAutomationRunWorkflow>
  | ReturnType<typeof createHandleConversationDeliveryWorkflow>
  | ReturnType<typeof createHandleIntegrationWebhookEventWorkflow>
  | ReturnType<typeof createSendOrganizationInvitationWorkflow>
  | ReturnType<typeof createSendVerificationOTPWorkflow>
  | ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>
  | ReturnType<typeof createStartSandboxProfileInstanceWorkflow>;

export type ControlPlaneWorkflowDefinitions = {
  handleAutomationRun: ReturnType<typeof createHandleAutomationRunWorkflow>;
  handleConversationDelivery: ReturnType<typeof createHandleConversationDeliveryWorkflow>;
  handleIntegrationWebhookEvent: ReturnType<typeof createHandleIntegrationWebhookEventWorkflow>;
  sendOrganizationInvitation: ReturnType<typeof createSendOrganizationInvitationWorkflow>;
  sendVerificationOTP: ReturnType<typeof createSendVerificationOTPWorkflow>;
  requestDeleteSandboxProfile: ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>;
  startSandboxProfileInstance: ReturnType<typeof createStartSandboxProfileInstanceWorkflow>;
};

export type CreateControlPlaneWorkflowDefinitionsInput = {
  handleAutomationRun: CreateHandleAutomationRunWorkflowInput;
  handleConversationDelivery: CreateHandleConversationDeliveryWorkflowInput;
  handleIntegrationWebhookEvent: CreateHandleIntegrationWebhookEventWorkflowInput;
  sendOrganizationInvitation: CreateSendOrganizationInvitationWorkflowInput;
  sendVerificationOTP: CreateSendVerificationOTPWorkflowInput;
  requestDeleteSandboxProfile: CreateRequestDeleteSandboxProfileWorkflowInput;
  startSandboxProfileInstance: CreateStartSandboxProfileInstanceWorkflowInput;
};

export function createControlPlaneWorkflowDefinitions(
  ctx: CreateControlPlaneWorkflowDefinitionsInput,
): ControlPlaneWorkflowDefinitions {
  return {
    handleAutomationRun: createHandleAutomationRunWorkflow(ctx.handleAutomationRun),
    handleConversationDelivery: createHandleConversationDeliveryWorkflow(
      ctx.handleConversationDelivery,
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
  };
}

export { HandleAutomationRunWorkflowSpec };
export type { HandleAutomationRunWorkflowInput, HandleAutomationRunWorkflowOutput };
export { HandleConversationDeliveryWorkflowSpec };
export type { HandleConversationDeliveryWorkflowInput, HandleConversationDeliveryWorkflowOutput };
export { HandleIntegrationWebhookEventWorkflowSpec };
export type {
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
};
export { SendOrganizationInvitationWorkflowSpec };
export { SendVerificationOTPWorkflowSpec };
export { RequestDeleteSandboxProfileWorkflowSpec };
export { StartSandboxProfileInstanceWorkflowSpec };
