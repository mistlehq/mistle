import type { EmailTemplate } from "../render.js";
import {
  buildOrganizationInvitationTemplate,
  type BuildOrganizationInvitationTemplateOptions,
} from "./organization-invitation/builder.js";
import { buildEmailOTPTemplate, type BuildEmailOTPTemplateOptions } from "./otp/builder.js";
import { EmailTemplateIds, type EmailTemplateId } from "./template-ids.js";
import { buildWelcomeTemplate, type BuildWelcomeTemplateOptions } from "./welcome/builder.js";

export type EmailTemplateInputById = {
  [EmailTemplateIds.OTP]: BuildEmailOTPTemplateOptions;
  [EmailTemplateIds.ORGANIZATION_INVITATION]: BuildOrganizationInvitationTemplateOptions;
  [EmailTemplateIds.WELCOME]: BuildWelcomeTemplateOptions;
};

type EmailTemplateBuilderById = {
  [TTemplateId in EmailTemplateId]: (
    input: EmailTemplateInputById[TTemplateId],
  ) => Promise<EmailTemplate>;
};

const EmailTemplateBuilders: EmailTemplateBuilderById = {
  [EmailTemplateIds.OTP]: buildEmailOTPTemplate,
  [EmailTemplateIds.ORGANIZATION_INVITATION]: buildOrganizationInvitationTemplate,
  [EmailTemplateIds.WELCOME]: buildWelcomeTemplate,
};

export function buildRegisteredEmailTemplate<TTemplateId extends EmailTemplateId>(
  templateId: TTemplateId,
  input: EmailTemplateInputById[TTemplateId],
): Promise<EmailTemplate> {
  return EmailTemplateBuilders[templateId](input);
}
