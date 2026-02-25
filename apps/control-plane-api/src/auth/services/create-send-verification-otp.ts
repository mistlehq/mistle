import {
  SendVerificationOTPWorkflowSpec,
  type SendVerificationOTPWorkflowInput,
  type createControlPlaneOpenWorkflow,
} from "@mistle/workflows/control-plane";

type OTPVerificationType = SendVerificationOTPWorkflowInput["type"];
type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;

type SendVerificationOTPRequest = {
  email: string;
  otp: string;
  type: OTPVerificationType;
};

type CreateSendVerificationOTPServiceInput = {
  openWorkflow: ControlPlaneOpenWorkflow;
  expiresInSeconds: number;
};

export function createSendVerificationOTPService(input: CreateSendVerificationOTPServiceInput) {
  const { openWorkflow, expiresInSeconds } = input;

  return async (data: SendVerificationOTPRequest): Promise<void> => {
    await openWorkflow.runWorkflow(SendVerificationOTPWorkflowSpec, {
      email: data.email,
      otp: data.otp,
      type: data.type,
      expiresInSeconds,
    });
  };
}
