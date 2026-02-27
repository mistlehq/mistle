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

/**
 * Control-plane workflow implementations.
 */
export type ControlPlaneWorkflowDefinition =
  | ReturnType<typeof createSendOrganizationInvitationWorkflow>
  | ReturnType<typeof createSendVerificationOTPWorkflow>
  | ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>;

export type ControlPlaneWorkflowDefinitions = {
  sendOrganizationInvitation: ReturnType<typeof createSendOrganizationInvitationWorkflow>;
  sendVerificationOTP: ReturnType<typeof createSendVerificationOTPWorkflow>;
  requestDeleteSandboxProfile: ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>;
};

export type CreateControlPlaneWorkflowDefinitionsInput = {
  sendOrganizationInvitation: CreateSendOrganizationInvitationWorkflowInput;
  sendVerificationOTP: CreateSendVerificationOTPWorkflowInput;
  requestDeleteSandboxProfile: CreateRequestDeleteSandboxProfileWorkflowInput;
};

export function createControlPlaneWorkflowDefinitions(
  ctx: CreateControlPlaneWorkflowDefinitionsInput,
): ControlPlaneWorkflowDefinitions {
  return {
    sendOrganizationInvitation: createSendOrganizationInvitationWorkflow(
      ctx.sendOrganizationInvitation,
    ),
    sendVerificationOTP: createSendVerificationOTPWorkflow(ctx.sendVerificationOTP),
    requestDeleteSandboxProfile: createRequestDeleteSandboxProfileWorkflow(
      ctx.requestDeleteSandboxProfile,
    ),
  };
}

export { SendOrganizationInvitationWorkflowSpec };
export { SendVerificationOTPWorkflowSpec };
export { RequestDeleteSandboxProfileWorkflowSpec };
