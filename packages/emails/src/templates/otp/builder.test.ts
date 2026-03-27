import { describe, expect, it } from "vitest";

import { buildEmailOTPTemplate } from "./builder.js";

describe("emails otp", () => {
  it("builds an OTP email template", async () => {
    const template = await buildEmailOTPTemplate({
      otp: "123456",
      type: "sign-in",
      expiresInSeconds: 300,
    });

    expect(template.subject).toBe("Your sign-in code");
    expect(template.metadata).toEqual({
      preview: "Use this code to sign in to Mistle. Expires in 5 minutes.",
      subject: "Your sign-in code",
      templateName: "OTP",
    });
    expect(template.html).toContain("123456");
    expect(template.text).toContain("123456");
    expect(template.text).toContain("5 minutes");
    expect(template.text).toContain("Use this code to sign in to Mistle");
  });

  it("builds preview text from the configured expiry and otp type", async () => {
    const template = await buildEmailOTPTemplate({
      otp: "654321",
      type: "email-verification",
      expiresInSeconds: 90,
    });

    expect(template.metadata.preview).toBe(
      "Confirm your email address for Mistle with this code. Expires in 2 minutes.",
    );
    expect(template.html).toContain(
      "Confirm your email address for Mistle with this code. Expires in 2 minutes.",
    );
    expect(template.text).toContain("Use this code to verify your email for Mistle");
  });

  it("uses password reset body copy for password reset otp emails", async () => {
    const template = await buildEmailOTPTemplate({
      otp: "654321",
      type: "forget-password",
      expiresInSeconds: 300,
    });

    expect(template.metadata.preview).toBe(
      "Use this code to reset your password on Mistle. Expires in 5 minutes.",
    );
    expect(template.text).toContain("Use this code to reset your password on Mistle");
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
