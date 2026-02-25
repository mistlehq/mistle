import {
  createRequestDeleteSandboxProfileWorkflow,
  RequestDeleteSandboxProfileWorkflowSpec,
  type CreateRequestDeleteSandboxProfileWorkflowInput,
} from "./request-delete-sandbox-profile/index.js";
import {
  createSendVerificationOTPWorkflow,
  SendVerificationOTPWorkflowSpec,
  type CreateSendVerificationOTPWorkflowInput,
} from "./send-verification-otp/index.js";

/**
 * Control-plane workflow implementations.
 */
export type ControlPlaneWorkflowDefinition =
  | ReturnType<typeof createSendVerificationOTPWorkflow>
  | ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>;

export type ControlPlaneWorkflowDefinitions = {
  sendVerificationOTP: ReturnType<typeof createSendVerificationOTPWorkflow>;
  requestDeleteSandboxProfile: ReturnType<typeof createRequestDeleteSandboxProfileWorkflow>;
};

export type CreateControlPlaneWorkflowDefinitionsInput = {
  sendVerificationOTP: CreateSendVerificationOTPWorkflowInput;
  requestDeleteSandboxProfile: CreateRequestDeleteSandboxProfileWorkflowInput;
};

export function createControlPlaneWorkflowDefinitions(
  input: CreateControlPlaneWorkflowDefinitionsInput,
): ControlPlaneWorkflowDefinitions {
  return {
    sendVerificationOTP: createSendVerificationOTPWorkflow(input.sendVerificationOTP),
    requestDeleteSandboxProfile: createRequestDeleteSandboxProfileWorkflow(
      input.requestDeleteSandboxProfile,
    ),
  };
}

export { SendVerificationOTPWorkflowSpec };
export { RequestDeleteSandboxProfileWorkflowSpec };
