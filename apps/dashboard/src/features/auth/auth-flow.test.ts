import { describe, expect, it } from "vitest";

import {
  createStateForDifferentEmail,
  resolveEmailValidationError,
  resolveOtpValidationError,
} from "./auth-flow.js";

describe("authFlow", () => {
  it("returns an error for empty email submissions", () => {
    expect(resolveEmailValidationError("")).toBe("Email is required.");
    expect(resolveEmailValidationError("   ")).toBe("Email is required.");
  });

  it("returns no error for non-empty email submissions", () => {
    expect(resolveEmailValidationError("user@example.com")).toBeNull();
  });

  it("returns an error for empty OTP submissions", () => {
    expect(resolveOtpValidationError("")).toBe("OTP is required.");
    expect(resolveOtpValidationError("  ")).toBe("OTP is required.");
  });

  it("returns no error for non-empty OTP submissions", () => {
    expect(resolveOtpValidationError("123456")).toBeNull();
  });

  it("resets auth state when user chooses a different email", () => {
    expect(createStateForDifferentEmail()).toEqual({
      authError: null,
      authStep: "email",
      otp: "",
    });
  });
});
