import { EmailTemplateIds, sendEmail } from "@mistle/emails";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "./context.js";

export type SendOrganizationInvitationWorkflowInput = {
  email: string;
  organizationName: string;
  inviterDisplayName: string;
  role: string;
  invitationUrl: string;
};

export type SendOrganizationInvitationWorkflowOutput = {
  messageId: string;
};

export const SendOrganizationInvitationWorkflow = defineWorkflow<
  SendOrganizationInvitationWorkflowInput,
  SendOrganizationInvitationWorkflowOutput
>(
  {
    name: "control-plane.auth.send-organization-invitation",
    version: "1",
  },
  async ({ input: { email, invitationUrl, inviterDisplayName, organizationName, role }, step }) => {
    const {
      email: { from, sender },
    } = await getWorkflowContext();

    return step.run(
      {
        name: "send-organization-invitation-email",
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
