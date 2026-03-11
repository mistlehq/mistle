import { EmailTemplateIds, sendEmail, type EmailTemplateInputById } from "@mistle/emails";
import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";

/**
 * Control-plane OTP email workflow input.
 */
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

export const SendVerificationOTPWorkflow = defineWorkflow(
  defineWorkflowSpec<SendVerificationOTPWorkflowInput, SendVerificationOTPWorkflowOutput>({
    name: "control-plane.auth.send-verification-otp",
    version: "1",
  }),
  async ({ input: workflowInput, step }) => {
    const runtime = await getControlPlaneWorkflowRuntime();
    const sendResult = await step.run({ name: "send-verification-otp-email" }, async () => {
      return sendEmail({
        sender: runtime.emailSender,
        from: runtime.emailFrom,
        to: [
          {
            email: workflowInput.email,
          },
        ],
        templateId: EmailTemplateIds.OTP,
        templateInput: {
          otp: workflowInput.otp,
          type: workflowInput.type,
          expiresInSeconds: workflowInput.expiresInSeconds,
        },
      });
    });

    return {
      messageId: sendResult.messageId,
    };
  },
);

export const SendVerificationOTPWorkflowSpec = SendVerificationOTPWorkflow.spec;
