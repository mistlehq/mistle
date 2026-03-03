import {
  createHandleIntegrationWebhookEventWorkflow,
  HandleIntegrationWebhookEventWorkflowSpec,
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
  | ReturnType<typeof createHandleIntegrationWebhookEventWorkflow>
  | ReturnType<typeof createSendOrganizationInvitationWorkflow>
  | ReturnType<typeof createSendVerificationOTPWorkflow>
  | ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>
  | ReturnType<typeof createStartSandboxProfileInstanceWorkflow>;

export type ControlPlaneWorkflowDefinitions = {
  handleIntegrationWebhookEvent: ReturnType<typeof createHandleIntegrationWebhookEventWorkflow>;
  sendOrganizationInvitation: ReturnType<typeof createSendOrganizationInvitationWorkflow>;
  sendVerificationOTP: ReturnType<typeof createSendVerificationOTPWorkflow>;
  requestDeleteSandboxProfile: ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>;
  startSandboxProfileInstance: ReturnType<typeof createStartSandboxProfileInstanceWorkflow>;
};

export type CreateControlPlaneWorkflowDefinitionsInput = {
  sendOrganizationInvitation: CreateSendOrganizationInvitationWorkflowInput;
  sendVerificationOTP: CreateSendVerificationOTPWorkflowInput;
  requestDeleteSandboxProfile: CreateRequestDeleteSandboxProfileWorkflowInput;
  startSandboxProfileInstance: CreateStartSandboxProfileInstanceWorkflowInput;
};

export function createControlPlaneWorkflowDefinitions(
  ctx: CreateControlPlaneWorkflowDefinitionsInput,
): ControlPlaneWorkflowDefinitions {
  return {
    handleIntegrationWebhookEvent: createHandleIntegrationWebhookEventWorkflow(),
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

export { HandleIntegrationWebhookEventWorkflowSpec };
export type {
  HandleIntegrationWebhookEventWorkflowInput,
  HandleIntegrationWebhookEventWorkflowOutput,
};
export { SendOrganizationInvitationWorkflowSpec };
export { SendVerificationOTPWorkflowSpec };
export { RequestDeleteSandboxProfileWorkflowSpec };
export { StartSandboxProfileInstanceWorkflowSpec };
