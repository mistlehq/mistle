import { EmailTemplateIds, sendEmail } from "@mistle/emails";
import { SendVerificationOTPWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const SendVerificationOTPWorkflow = defineWorkflow(
  SendVerificationOTPWorkflowSpec,
  async ({ input: { email, expiresInSeconds, otp, type }, step }) => {
    const {
      services: { emailDelivery },
    } = await getWorkflowContext();

    return step.run(
      {
        name: "send-verification-otp-email",
      },
      async () => {
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

        return {
          messageId: sendResult.messageId,
        };
      },
    );
  },
);
