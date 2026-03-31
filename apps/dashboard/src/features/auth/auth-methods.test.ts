import { describe, expect, it } from "vitest";

import { AuthMethodIds, hasEnabledAuthMethod, resolveEnabledAuthMethods } from "./auth-methods.js";

describe("resolveEnabledAuthMethods", () => {
  it("returns enabled auth methods in the configured UI order", () => {
    expect(
      resolveEnabledAuthMethods({
        google: true,
      }),
    ).toEqual([
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
    ]);
  });

  it("filters out disabled auth methods", () => {
    const authMethods = resolveEnabledAuthMethods({
      google: false,
    });

    expect(authMethods).toEqual([
      {
        id: AuthMethodIds.EMAIL_OTP,
        kind: "form",
        label: "Email OTP",
      },
    ]);
    expect(hasEnabledAuthMethod(authMethods, AuthMethodIds.GOOGLE)).toBe(false);
  });
});
