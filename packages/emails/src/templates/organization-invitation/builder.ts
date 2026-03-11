import { createElement } from "react";

import { type EmailTemplate, renderEmail, renderEmailText } from "../../render.js";
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
  return {
    organizationName: options.organizationName,
    inviterDisplayName: options.inviterDisplayName,
    role: options.role,
    invitationUrl: options.invitationUrl,
  };
}

function getInvitationSubject(organizationName: string): string {
  return `You're invited to join ${organizationName}`;
}

export async function buildOrganizationInvitationTemplate(
  options: BuildOrganizationInvitationTemplateOptions,
): Promise<EmailTemplate> {
  const subject = getInvitationSubject(options.organizationName);
  const template = createElement(OrganizationInvitationTemplate, buildTemplateProps(options));
  const html = await renderEmail(template);

  return {
    subject,
    html,
    text: await renderEmailText(template),
  };
}
