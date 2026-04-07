// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OtpStepForm } from "./otp-step-form.js";

describe("OtpStepForm", () => {
  it("provides a programmatic label for the one-time code input", () => {
    const markup = renderToStaticMarkup(
      <OtpStepForm
        email="user@example.com"
        isVerifyingOtp={false}
        onOtpChange={() => {}}
        onSubmit={async () => {}}
        onUseDifferentEmail={() => {}}
        otp=""
      />,
    );

    expect(markup).toContain('for="otp"');
    expect(markup).toContain(">One-time code<");
    expect(markup).toContain('id="otp"');
    expect(markup).toContain('name="otp"');
    expect(markup).toContain('autoComplete="one-time-code"');
  });

  it("keeps the OTP input visible to pointer interaction", () => {
    const markup = renderToStaticMarkup(
      <OtpStepForm
        email="user@example.com"
        isVerifyingOtp={false}
        onOtpChange={() => {}}
        onSubmit={async () => {}}
        onUseDifferentEmail={() => {}}
        otp=""
      />,
    );

    expect(markup).not.toContain('data-slot="input-otp" class="sr-only');
  });

  it("autofocuses the OTP input", () => {
    const markup = renderToStaticMarkup(
      <OtpStepForm
        email="user@example.com"
        isVerifyingOtp={false}
        onOtpChange={() => {}}
        onSubmit={async () => {}}
        onUseDifferentEmail={() => {}}
        otp=""
      />,
    );

    expect(markup).toContain("autofocus");
  });
});
