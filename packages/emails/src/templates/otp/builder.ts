import { createElement } from "react";

import { type EmailTemplate, renderEmail, renderEmailText } from "../../render.js";
import { EmailOtpTemplate, type EmailOtpTemplateProps } from "./template.jsx";

export type OtpVerificationType = "sign-in" | "email-verification" | "forget-password";

export type BuildEmailOtpTemplateOptions = {
  otp: string;
  type: OtpVerificationType;
  expiresInSeconds: number;
};

function getSubjectForOtpType(type: OtpVerificationType): string {
  if (type === "email-verification") {
    return "Verify your email";
  }
  if (type === "forget-password") {
    return "Your password reset code";
  }
  return "Your sign-in code";
}

function buildTemplateProps(options: BuildEmailOtpTemplateOptions): EmailOtpTemplateProps {
  return {
    otp: options.otp,
    expiresInSeconds: options.expiresInSeconds,
    title: getSubjectForOtpType(options.type),
  };
}

export async function buildEmailOtpTemplate(
  options: BuildEmailOtpTemplateOptions,
): Promise<EmailTemplate> {
  const subject = getSubjectForOtpType(options.type);
  const html = await renderEmail(createElement(EmailOtpTemplate, buildTemplateProps(options)));

  return {
    subject,
    html,
    text: renderEmailText(html),
  };
}
