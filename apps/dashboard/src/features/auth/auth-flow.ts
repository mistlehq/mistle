export type AuthStep = "email" | "otp";

export function resolveEmailValidationError(email: string): string | null {
  return email.trim().length === 0 ? "Email is required." : null;
}

export function resolveOtpValidationError(otp: string): string | null {
  return otp.trim().length === 0 ? "OTP is required." : null;
}

export function createStateForDifferentEmail(): {
  authStep: AuthStep;
  authError: string | null;
  otp: string;
} {
  return {
    authStep: "email",
    authError: null,
    otp: "",
  };
}
