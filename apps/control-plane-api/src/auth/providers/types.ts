import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import type { OAuth2Tokens } from "better-auth/oauth2";

export type EmailOtpProviderConfig = {
  otpLength: number;
  otpExpiresInSeconds: number;
  otpAllowedAttempts: number;
};

export type GoogleProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint?: string;
  verifyIdToken?: (token: string, nonce?: string) => Promise<boolean>;
  getUserInfo?: (token: OAuth2Tokens) => Promise<{
    user: {
      id: string;
      name?: string;
      email?: string | null;
      image?: string;
      emailVerified: boolean;
    };
    data: Record<string, unknown>;
  } | null>;
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
