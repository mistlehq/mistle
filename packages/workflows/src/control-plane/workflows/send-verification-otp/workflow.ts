import { EmailTemplateIds, sendEmail, type EmailSender } from "@mistle/emails";
import { defineWorkflow, type Workflow } from "openworkflow";

import {
  SendVerificationOTPWorkflowSpec,
  type SendVerificationOTPWorkflowInput,
  type SendVerificationOTPWorkflowOutput,
} from "./spec.js";

export type CreateSendVerificationOTPWorkflowInput = {
  emailSender: EmailSender;
  from: {
    email: string;
    name: string;
  };
};

/**
 * Creates the control-plane OTP email workflow implementation.
 */
export function createSendVerificationOTPWorkflow(
  input: CreateSendVerificationOTPWorkflowInput,
): Workflow<
  SendVerificationOTPWorkflowInput,
  SendVerificationOTPWorkflowOutput,
  SendVerificationOTPWorkflowInput
> {
  return defineWorkflow(SendVerificationOTPWorkflowSpec, async ({ input: workflowInput, step }) => {
    const sendResult = await step.run({ name: "send-verification-otp-email" }, async () => {
      return sendEmail({
        sender: input.emailSender,
        from: input.from,
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
  });
}
