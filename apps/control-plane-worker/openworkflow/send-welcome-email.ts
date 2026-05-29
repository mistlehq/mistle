import { EmailSendError, EmailTemplateIds, sendEmail } from "@mistle/emails";
import { SendWelcomeEmailWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { logger } from "../logger.js";
import { getWorkflowContext } from "./core/context.js";
import { defineTracedControlPlaneWorkflow } from "./core/tracing.js";

const WelcomeEmailFrom = {
  email: "jonathan@mistle.dev",
  name: "Jonathan",
};

export const SendWelcomeEmailWorkflow = defineTracedControlPlaneWorkflow(
  SendWelcomeEmailWorkflowSpec,
  async ({ input: { callUrl, email }, step }) => {
    const { emailDelivery } = await getWorkflowContext();

    return step.run(
      {
        name: "send-welcome-email",
      },
      async () => {
        try {
          const sendResult = await sendEmail({
            sender: emailDelivery.emailSender,
            from: WelcomeEmailFrom,
            to: [
              {
                email,
              },
            ],
            templateId: EmailTemplateIds.WELCOME,
            templateInput: {
              callUrl,
            },
          });

          logger.info(
            {
              messageId: sendResult.messageId,
              workflowName: SendWelcomeEmailWorkflowSpec.name,
            },
            "Sent welcome email",
          );

          return {
            messageId: sendResult.messageId,
          };
        } catch (error) {
          logger.error(
            {
              emailErrorCode: error instanceof EmailSendError ? error.code : undefined,
              err: error,
              retryable: error instanceof EmailSendError ? error.retryable : undefined,
              workflowName: SendWelcomeEmailWorkflowSpec.name,
            },
            "Failed to send welcome email",
          );
          throw error;
        }
      },
    );
  },
);
