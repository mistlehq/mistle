export const EmailTemplateIds = {
  OTP: "otp",
} as const;

export type EmailTemplateId = (typeof EmailTemplateIds)[keyof typeof EmailTemplateIds];
