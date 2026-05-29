export const EmailTemplateIds = {
  OTP: "otp",
  ORGANIZATION_INVITATION: "organization-invitation",
  WELCOME: "welcome",
} as const;

export type EmailTemplateId = (typeof EmailTemplateIds)[keyof typeof EmailTemplateIds];
