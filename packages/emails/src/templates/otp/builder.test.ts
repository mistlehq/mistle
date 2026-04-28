import { describe, expect, it } from "vitest";

import { buildEmailOTPTemplate } from "./builder.js";

describe("emails otp", () => {
  it("builds an OTP email template", async () => {
    const template = await buildEmailOTPTemplate({
      otp: "123456",
      type: "sign-in",
      expiresInSeconds: 300,
    });

    expect(template.subject).toBe("Your Mistle sign-in code");
    expect(template.metadata).toEqual({
      subject: "Your Mistle sign-in code",
      templateName: "OTP",
    });
    expect(template.html).toContain("123456");
    expect(template.text).toContain("123456");
    expect(template.text).toContain("5 minutes");
  });

  it("builds email verification OTP emails", async () => {
    const template = await buildEmailOTPTemplate({
      otp: "654321",
      type: "email-verification",
      expiresInSeconds: 90,
    });

    expect(template.metadata).toEqual({
      subject: "Verify your email for Mistle",
      templateName: "OTP",
    });
    expect(template.html).toContain("654321");
  });

  it("builds password reset OTP emails", async () => {
    const template = await buildEmailOTPTemplate({
      otp: "654321",
      type: "forget-password",
      expiresInSeconds: 300,
    });

    expect(template.metadata).toEqual({
      subject: "Your Mistle password reset code",
      templateName: "OTP",
    });
    expect(template.html).toContain("654321");
  });

  it("matches snapshot for a stable OTP template output", async () => {
    const template = await buildEmailOTPTemplate({
      otp: "123456",
      type: "sign-in",
      expiresInSeconds: 300,
    });

    expect(template).toMatchSnapshot();
  });
});
