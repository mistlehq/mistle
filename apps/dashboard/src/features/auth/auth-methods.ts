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

export type AuthMethodAvailability = {
  google: boolean;
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
  authMethodAvailability: AuthMethodAvailability,
): readonly AuthMethod[] {
  return AuthMethodCatalog.filter(
    (method) => method.id === AuthMethodIds.EMAIL_OTP || authMethodAvailability[method.id] === true,
  );
}

export function hasEnabledAuthMethod(
  authMethods: readonly AuthMethod[],
  authMethodId: AuthMethodId,
): boolean {
  return authMethods.some((authMethod) => authMethod.id === authMethodId);
}
