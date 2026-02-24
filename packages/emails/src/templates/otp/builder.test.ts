import { describe, expect, it } from "vitest";

import { buildEmailOtpTemplate } from "./builder.js";

describe("emails otp", () => {
  it("builds an OTP email template", async () => {
    const template = await buildEmailOtpTemplate({
      otp: "123456",
      type: "sign-in",
      expiresInSeconds: 300,
    });

    expect(template.subject).toBe("Your sign-in code");
    expect(template.html).toContain("123456");
    expect(template.text).toContain("123456");
    expect(template.text).toContain("5 minutes");
  });

  it("matches snapshot for a stable OTP template output", async () => {
    const template = await buildEmailOtpTemplate({
      otp: "123456",
      type: "sign-in",
      expiresInSeconds: 300,
    });

    expect(template).toMatchSnapshot();
  });
});
