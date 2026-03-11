import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import { getControlPlaneWorkflowRuntime } from "../runtime-context.js";

const INVITATION_SUBJECT_PREFIX = "You're invited to join";

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMessage(input: {
  from: {
    email: string;
    name: string;
  };
  toEmail: string;
  organizationName: string;
  inviterDisplayName: string;
  role: string;
  invitationUrl: string;
}) {
  const subject = `${INVITATION_SUBJECT_PREFIX} ${input.organizationName}`;
  const escapedOrganizationName = escapeHtml(input.organizationName);
  const escapedInviterDisplayName = escapeHtml(input.inviterDisplayName);
  const escapedRole = escapeHtml(input.role);
  const escapedInvitationUrl = escapeHtml(input.invitationUrl);

  return {
    from: input.from,
    toEmail: input.toEmail,
    subject,
    html: `
      <p>${escapedInviterDisplayName} invited you to join ${escapedOrganizationName} as ${escapedRole}.</p>
      <p><a href="${escapedInvitationUrl}">Accept invitation</a></p>
      <p>If you did not expect this invitation, you can ignore this email.</p>
    `.trim(),
    text: [
      `${input.inviterDisplayName} invited you to join ${input.organizationName} as ${input.role}.`,
      "",
      `Accept invitation: ${input.invitationUrl}`,
      "",
      "If you did not expect this invitation, you can ignore this email.",
    ].join("\n"),
  };
}

export const SendOrganizationInvitationWorkflow = defineWorkflow(
  defineWorkflowSpec<
    SendOrganizationInvitationWorkflowInput,
    SendOrganizationInvitationWorkflowOutput
  >({
    name: "control-plane.auth.send-organization-invitation",
    version: "1",
  }),
  async ({ input: workflowInput, step }) => {
    const runtime = await getControlPlaneWorkflowRuntime();
    const message = buildMessage({
      from: runtime.emailFrom,
      toEmail: workflowInput.email,
      organizationName: workflowInput.organizationName,
      inviterDisplayName: workflowInput.inviterDisplayName,
      role: workflowInput.role,
      invitationUrl: workflowInput.invitationUrl,
    });
    const sendResult = await step.run({ name: "send-organization-invitation-email" }, async () =>
      runtime.emailSender.send({
        from: message.from,
        to: [
          {
            email: message.toEmail,
          },
        ],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    );

    if (!sendResult.ok) {
      const codeSuffix = sendResult.code === undefined ? "" : ` (${sendResult.code})`;
      throw new Error(
        `Failed to send organization invitation email${codeSuffix}: ${sendResult.message}`,
      );
    }

    return {
      messageId: sendResult.messageId,
    };
  },
);

export const SendOrganizationInvitationWorkflowSpec = SendOrganizationInvitationWorkflow.spec;
