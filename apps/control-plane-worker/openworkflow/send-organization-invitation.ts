import { EmailTemplateIds, sendEmail } from "@mistle/emails";
import { SendOrganizationInvitationWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "./core/context.js";

export const SendOrganizationInvitationWorkflow = defineWorkflow(
  SendOrganizationInvitationWorkflowSpec,
  async ({ input: { email, invitationUrl, inviterDisplayName, organizationName, role }, step }) => {
    const { emailDelivery } = await getWorkflowContext();

    return step.run(
      {
        name: "send-organization-invitation-email",
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
          templateId: EmailTemplateIds.ORGANIZATION_INVITATION,
          templateInput: {
            organizationName,
            inviterDisplayName,
            role,
            invitationUrl,
          },
        });

        return {
          messageId: sendResult.messageId,
        };
      },
    );
  },
);
