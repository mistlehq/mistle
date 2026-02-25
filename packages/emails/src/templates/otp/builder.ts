import { createElement } from "react";

import { type EmailTemplate, renderEmail, renderEmailText } from "../../render.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "./template.jsx";

export type OTPVerificationType = "sign-in" | "email-verification" | "forget-password";

export type BuildEmailOTPTemplateOptions = {
  otp: string;
  type: OTPVerificationType;
  expiresInSeconds: number;
};

function getSubjectForOTPType(type: OTPVerificationType): string {
  if (type === "email-verification") {
    return "Verify your email";
  }
  if (type === "forget-password") {
    return "Your password reset code";
  }
  return "Your sign-in code";
}

function buildTemplateProps(options: BuildEmailOTPTemplateOptions): EmailOTPTemplateProps {
  return {
    otp: options.otp,
    expiresInSeconds: options.expiresInSeconds,
    title: getSubjectForOTPType(options.type),
  };
}

export async function buildEmailOTPTemplate(
  options: BuildEmailOTPTemplateOptions,
): Promise<EmailTemplate> {
  const subject = getSubjectForOTPType(options.type);
  const template = createElement(EmailOTPTemplate, buildTemplateProps(options));
  const html = await renderEmail(template);

  return {
    subject,
    html,
    text: await renderEmailText(template),
  };
}
