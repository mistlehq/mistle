import {
  SendVerificationOTPWorkflowSpec,
  type createControlPlaneOpenWorkflow,
} from "@control-plane/workflows";
import type { EmailOTPOptions } from "better-auth/plugins";

type ControlPlaneOpenWorkflow = ReturnType<typeof createControlPlaneOpenWorkflow>;
type SendVerificationOTPRequest = Parameters<EmailOTPOptions["sendVerificationOTP"]>[0];

type CreateSendVerificationOTPServiceInput = {
  openWorkflow: ControlPlaneOpenWorkflow;
  expiresInSeconds: number;
};

export function createSendVerificationOTPService(input: CreateSendVerificationOTPServiceInput) {
  const { openWorkflow, expiresInSeconds } = input;

  return async (data: SendVerificationOTPRequest): Promise<void> => {
    if (data.type === "change-email") {
      throw new Error("Unsupported OTP verification type: change-email.");
    }

    await openWorkflow.runWorkflow(SendVerificationOTPWorkflowSpec, {
      email: data.email,
      otp: data.otp,
      type: data.type,
      expiresInSeconds,
    });
  };
}
