import { createElement } from "react";

import {
  type EmailTemplate,
  type EmailTemplateMetadata,
  renderEmail,
  renderEmailText,
} from "../../render.js";
import {
  OrganizationInvitationTemplate,
  type OrganizationInvitationTemplateProps,
} from "./template.js";

export type BuildOrganizationInvitationTemplateOptions = {
  organizationName: string;
  inviterDisplayName: string;
  role: string;
  invitationUrl: string;
};

function buildTemplateProps(
  options: BuildOrganizationInvitationTemplateOptions,
): OrganizationInvitationTemplateProps {
  const metadata = buildMetadata(options);

  return {
    organizationName: options.organizationName,
    inviterDisplayName: options.inviterDisplayName,
    preview: metadata.preview,
    role: options.role,
    invitationUrl: options.invitationUrl,
  };
}

function getInvitationSubject(organizationName: string): string {
  return `Join ${organizationName} on Mistle`;
}

function buildMetadata(options: BuildOrganizationInvitationTemplateOptions): EmailTemplateMetadata {
  const subject = getInvitationSubject(options.organizationName);

  return {
    templateName: "Organization Invitation",
    subject,
    preview: `${options.inviterDisplayName} invited you to join ${options.organizationName} as ${options.role}.`,
  };
}

export async function buildOrganizationInvitationTemplate(
  options: BuildOrganizationInvitationTemplateOptions,
): Promise<EmailTemplate> {
  const metadata = buildMetadata(options);
  const template = createElement(OrganizationInvitationTemplate, buildTemplateProps(options));
  const html = await renderEmail(template);

  return {
    metadata,
    subject: metadata.subject,
    html,
    text: await renderEmailText(template),
  };
}
