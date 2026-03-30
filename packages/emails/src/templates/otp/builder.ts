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

function toDisplayMinutes(expiresInSeconds: number): number {
  return Math.max(1, Math.ceil(expiresInSeconds / 60));
}

function getSubjectForOTPType(type: OTPVerificationType): string {
  if (type === "email-verification") {
    return "Verify your email";
  }
  if (type === "forget-password") {
    return "Your password reset code";
  }
  return "Your sign-in code";
}

function getBodyMessageForOTPType(type: OTPVerificationType): string {
  if (type === "email-verification") {
    return "Use this code to verify your email for Mistle";
  }
  if (type === "forget-password") {
    return "Use this code to reset your password on Mistle";
  }
  return "Use this code to sign in to Mistle";
}

function buildTemplateProps(options: BuildEmailOTPTemplateOptions): EmailOTPTemplateProps {
  const metadata = buildMetadata(options);

  return {
    bodyMessage: getBodyMessageForOTPType(options.type),
    otp: options.otp,
    expiresInSeconds: options.expiresInSeconds,
    preview: metadata.preview,
    title: metadata.subject,
  };
}

function buildMetadata(options: BuildEmailOTPTemplateOptions): EmailTemplateMetadata {
  const subject = getSubjectForOTPType(options.type);
  const expiryMinutes = toDisplayMinutes(options.expiresInSeconds);
  const expiresInCopy = `Expires in ${expiryMinutes} minute${expiryMinutes === 1 ? "" : "s"}.`;

  let preview = `Use this code to sign in to Mistle. ${expiresInCopy}`;

  if (options.type === "email-verification") {
    preview = `Confirm your email address for Mistle with this code. ${expiresInCopy}`;
  }

  if (options.type === "forget-password") {
    preview = `Use this code to reset your password on Mistle. ${expiresInCopy}`;
  }

  return {
    templateName: "OTP",
    subject,
    preview,
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
