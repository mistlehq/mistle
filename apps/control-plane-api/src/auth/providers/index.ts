import type { BetterAuthOptions } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";

import { createEmailOtpProvider } from "./email-otp.js";
import { createGoogleSocialProvider } from "./google.js";
import type { AuthProviderAssembly, AuthProviderConfig } from "./types.js";

type CreateAuthProvidersInput = {
  config: AuthProviderConfig;
  sendVerificationOTP: (input: {
    email: string;
    otp: string;
    type: "change-email" | "email-verification" | "forget-password" | "sign-in";
  }) => Promise<void>;
};

function createEmptySocialProviders(): NonNullable<BetterAuthOptions["socialProviders"]> {
  return {};
}

export function createAuthProviders(input: CreateAuthProvidersInput): AuthProviderAssembly {
  const plugins: BetterAuthPlugin[] = [
    createEmailOtpProvider({
      config: input.config.emailOtp,
      sendVerificationOTP: input.sendVerificationOTP,
    }),
  ];
  let socialProviders = createEmptySocialProviders();

  if (input.config.google !== null) {
    socialProviders = createGoogleSocialProvider(input.config.google);
  }

  return {
    options: {
      plugins,
      socialProviders,
    },
  };
}

export type { AuthProviderConfig } from "./types.js";
