export const EmailTemplateIds = {
  OTP: "otp",
  ORGANIZATION_INVITATION: "organization-invitation",
} as const;

export type EmailTemplateId = (typeof EmailTemplateIds)[keyof typeof EmailTemplateIds];
