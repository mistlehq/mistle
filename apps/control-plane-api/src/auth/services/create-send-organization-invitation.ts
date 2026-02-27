import type { SMTPEmailSender } from "@mistle/emails";

const INVITATION_SUBJECT_PREFIX = "You're invited to join";

type CreateSendOrganizationInvitationServiceInput = {
  emailSender: SMTPEmailSender;
  fromAddress: string;
  fromName: string;
  invitationAcceptBaseUrl: string;
};

type SendOrganizationInvitationInput = {
  email: string;
  invitationId: string;
  organizationName: string;
  inviterDisplayName: string;
  role: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInvitationUrl(input: {
  invitationAcceptBaseUrl: string;
  invitationId: string;
  email: string;
  organizationName: string;
  inviterDisplayName: string;
}): string {
  const url = new URL(input.invitationAcceptBaseUrl);
  url.searchParams.set("invitationId", input.invitationId);
  url.searchParams.set("email", input.email);
  url.searchParams.set("organizationName", input.organizationName);
  url.searchParams.set("invitedBy", input.inviterDisplayName);

  return url.toString();
}

function buildMessage(input: {
  toEmail: string;
  fromAddress: string;
  fromName: string;
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
    toEmail: input.toEmail,
    fromAddress: input.fromAddress,
    fromName: input.fromName,
  };
}

export function createSendOrganizationInvitationService(
  input: CreateSendOrganizationInvitationServiceInput,
): (inviteInput: SendOrganizationInvitationInput) => Promise<void> {
  return async (inviteInput) => {
    const invitationUrl = buildInvitationUrl({
      invitationAcceptBaseUrl: input.invitationAcceptBaseUrl,
      invitationId: inviteInput.invitationId,
      email: inviteInput.email,
      organizationName: inviteInput.organizationName,
      inviterDisplayName: inviteInput.inviterDisplayName,
    });
    const message = buildMessage({
      toEmail: inviteInput.email,
      fromAddress: input.fromAddress,
      fromName: input.fromName,
      organizationName: inviteInput.organizationName,
      inviterDisplayName: inviteInput.inviterDisplayName,
      role: inviteInput.role,
      invitationUrl,
    });

    const result = await input.emailSender.send({
      from: {
        email: message.fromAddress,
        name: message.fromName,
      },
      to: [
        {
          email: message.toEmail,
        },
      ],
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    if (!result.ok) {
      const codeSuffix = result.code === undefined ? "" : ` (${result.code})`;
      throw new Error(
        `Failed to send organization invitation email${codeSuffix}: ${result.message}`,
      );
    }
  };
}
