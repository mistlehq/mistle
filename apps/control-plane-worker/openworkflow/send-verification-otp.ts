import { EmailSendError, EmailTemplateIds, sendEmail } from "@mistle/emails";
import { SendVerificationOTPWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { logger } from "../logger.js";
import { getWorkflowContext } from "./core/context.js";
import { defineTracedControlPlaneWorkflow } from "./core/tracing.js";

export const SendVerificationOTPWorkflow = defineTracedControlPlaneWorkflow(
  SendVerificationOTPWorkflowSpec,
  async ({ input: { email, expiresInSeconds, otp, type }, step }) => {
    const { emailDelivery } = await getWorkflowContext();

    return step.run(
      {
        name: "send-verification-otp-email",
      },
      async () => {
        try {
          const sendResult = await sendEmail({
            sender: emailDelivery.emailSender,
            from: emailDelivery.from,
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

          logger.info(
            {
              messageId: sendResult.messageId,
              otpType: type,
              workflowName: SendVerificationOTPWorkflowSpec.name,
            },
            "Sent OTP verification email",
          );

          return {
            messageId: sendResult.messageId,
          };
        } catch (error) {
          logger.error(
            {
              emailErrorCode: error instanceof EmailSendError ? error.code : undefined,
              err: error,
              otpType: type,
              retryable: error instanceof EmailSendError ? error.retryable : undefined,
              workflowName: SendVerificationOTPWorkflowSpec.name,
            },
            "Failed to send OTP verification email",
          );
          throw error;
        }
      },
    );
  },
);
