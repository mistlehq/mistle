import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";

export type EmailOtpProviderConfig = {
  otpLength: number;
  otpExpiresInSeconds: number;
  otpAllowedAttempts: number;
};

export type GoogleProviderConfig = {
  clientId: string;
  clientSecret: string;
};

export type AuthProviderConfig = {
  emailOtp: EmailOtpProviderConfig;
  google: GoogleProviderConfig | null;
};

export type AuthProviderAssembly = {
  options: {
    plugins: BetterAuthPlugin[];
    socialProviders: NonNullable<BetterAuthOptions["socialProviders"]>;
  };
};

export type AuthPluginFactoryInput = {
  config: AuthProviderConfig;
};
