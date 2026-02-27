import type { EmailTemplate } from "../render.js";
import { buildEmailOTPTemplate, type BuildEmailOTPTemplateOptions } from "./otp/builder.js";
import { EmailTemplateIds, type EmailTemplateId } from "./template-ids.js";

export type EmailTemplateInputById = {
  [EmailTemplateIds.OTP]: BuildEmailOTPTemplateOptions;
};

type EmailTemplateBuilderById = {
  [TTemplateId in EmailTemplateId]: (
    input: EmailTemplateInputById[TTemplateId],
  ) => Promise<EmailTemplate>;
};

const EmailTemplateBuilders: EmailTemplateBuilderById = {
  [EmailTemplateIds.OTP]: buildEmailOTPTemplate,
};

export function buildRegisteredEmailTemplate<TTemplateId extends EmailTemplateId>(
  templateId: TTemplateId,
  input: EmailTemplateInputById[TTemplateId],
): Promise<EmailTemplate> {
  return EmailTemplateBuilders[templateId](input);
}
