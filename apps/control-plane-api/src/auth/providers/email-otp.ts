import { emailOTP } from "better-auth/plugins";

import type { AuthProviderConfig } from "./types.js";

type CreateEmailOtpProviderInput = {
  config: AuthProviderConfig["emailOtp"];
  sendVerificationOTP: (input: {
    email: string;
    otp: string;
    type: "change-email" | "email-verification" | "forget-password" | "sign-in";
  }) => Promise<void>;
};

export function createEmailOtpProvider(input: CreateEmailOtpProviderInput) {
  return emailOTP({
    otpLength: input.config.otpLength,
    expiresIn: input.config.otpExpiresInSeconds,
    allowedAttempts: input.config.otpAllowedAttempts,
    disableSignUp: !input.config.allowSignups,
    sendVerificationOTP: input.sendVerificationOTP,
  });
}
