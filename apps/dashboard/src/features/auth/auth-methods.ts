import type { AuthCapabilities } from "./auth-capabilities.js";

export const AuthMethodIds = {
  EMAIL_OTP: "emailOtp",
  GOOGLE: "google",
} as const;

export type AuthMethodId = (typeof AuthMethodIds)[keyof typeof AuthMethodIds];

export type AuthMethod = {
  id: AuthMethodId;
  kind: "form" | "social";
  label: string;
};

const AuthMethodCatalog: readonly AuthMethod[] = [
  {
    id: AuthMethodIds.EMAIL_OTP,
    kind: "form",
    label: "Email OTP",
  },
  {
    id: AuthMethodIds.GOOGLE,
    kind: "social",
    label: "Google",
  },
] as const;

export function resolveEnabledAuthMethods(
  authCapabilities: AuthCapabilities,
): readonly AuthMethod[] {
  return AuthMethodCatalog.filter((method) => authCapabilities.methods[method.id]);
}

export function hasEnabledAuthMethod(
  authMethods: readonly AuthMethod[],
  authMethodId: AuthMethodId,
): boolean {
  return authMethods.some((authMethod) => authMethod.id === authMethodId);
}
