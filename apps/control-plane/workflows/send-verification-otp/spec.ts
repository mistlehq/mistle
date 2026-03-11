import { type EmailTemplateInputById, EmailTemplateIds } from "@mistle/emails";
import { defineWorkflowSpec } from "openworkflow";

type OTPVerificationType = EmailTemplateInputById[typeof EmailTemplateIds.OTP]["type"];

export type SendVerificationOTPWorkflowInput = {
  email: string;
  otp: string;
  type: OTPVerificationType;
  expiresInSeconds: number;
};

export type SendVerificationOTPWorkflowOutput = {
  messageId: string;
};

export const SendVerificationOTPWorkflowSpec = defineWorkflowSpec<
  SendVerificationOTPWorkflowInput,
  SendVerificationOTPWorkflowOutput
>({
  name: "control-plane.auth.send-verification-otp",
  version: "1",
});
