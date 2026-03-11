import { EmailTemplateIds, sendEmail, type EmailTemplateInputById } from "@mistle/emails";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "./context.js";

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

export const SendVerificationOTPWorkflow = defineWorkflow<
  SendVerificationOTPWorkflowInput,
  SendVerificationOTPWorkflowOutput
>(
  {
    name: "control-plane.auth.send-verification-otp",
    version: "1",
  },
  async ({ input: { email, expiresInSeconds, otp, type }, step }) => {
    const {
      email: { from, sender },
    } = await getWorkflowContext();

    return step.run(
      {
        name: "send-verification-otp-email",
      },
      async () => {
        const sendResult = await sendEmail({
          sender,
          from,
          to: [
            {
              email,
            },
          ],
          templateId: EmailTemplateIds.OTP,
          templateInput: {
            otp,
            type,
            expiresInSeconds,
          },
        });

        return {
          messageId: sendResult.messageId,
        };
      },
    );
  },
);

export const SendVerificationOTPWorkflowSpec = SendVerificationOTPWorkflow.spec;
