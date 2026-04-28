import { createElement } from "react";

import {
  type EmailTemplate,
  type EmailTemplateMetadata,
  renderEmail,
  renderEmailText,
} from "../../render.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "./template.js";

export type OTPVerificationType = "sign-in" | "email-verification" | "forget-password";

export type BuildEmailOTPTemplateOptions = {
  otp: string;
  type: OTPVerificationType;
  expiresInSeconds: number;
};

function getSubjectForOTPType(type: OTPVerificationType): string {
  if (type === "email-verification") {
    return "Verify your email for Mistle";
  }
  if (type === "forget-password") {
    return "Your Mistle password reset code";
  }
  return "Your Mistle sign-in code";
}

function getTitleForOTPType(type: OTPVerificationType): string {
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
    title: getTitleForOTPType(options.type),
  };
}

function buildMetadata(options: BuildEmailOTPTemplateOptions): EmailTemplateMetadata {
  const subject = getSubjectForOTPType(options.type);

  return {
    templateName: "OTP",
    subject,
  };
}

export async function buildEmailOTPTemplate(
  options: BuildEmailOTPTemplateOptions,
): Promise<EmailTemplate> {
  const metadata = buildMetadata(options);
  const template = createElement(EmailOTPTemplate, buildTemplateProps(options));
  const html = await renderEmail(template);

  return {
    metadata,
    subject: metadata.subject,
    html,
    text: await renderEmailText(template),
  };
}
