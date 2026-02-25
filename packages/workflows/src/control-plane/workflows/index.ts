import {
  createSendVerificationOTPWorkflow,
  SendVerificationOTPWorkflowSpec,
  type CreateSendVerificationOTPWorkflowInput,
} from "./send-verification-otp/index.js";

/**
 * Control-plane workflow implementations.
 */
export type ControlPlaneWorkflowDefinition = ReturnType<typeof createSendVerificationOTPWorkflow>;

export type CreateControlPlaneWorkflowDefinitionsInput = {
  sendVerificationOTP: CreateSendVerificationOTPWorkflowInput;
};

export function createControlPlaneWorkflowDefinitions(
  input: CreateControlPlaneWorkflowDefinitionsInput,
): ReadonlyArray<ControlPlaneWorkflowDefinition> {
  return [createSendVerificationOTPWorkflow(input.sendVerificationOTP)];
}

export { SendVerificationOTPWorkflowSpec };
