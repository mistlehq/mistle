// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { OtpStepForm } from "./otp-step-form.js";

describe("OtpStepForm", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });

    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value() {
        return null;
      },
      writable: true,
    });
  });

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

  it("submits automatically when the OTP is fully entered", async () => {
    function TestHarness(): React.JSX.Element {
      const [otp, setOtp] = useState("");
      const [submitCount, setSubmitCount] = useState(0);

      async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        setSubmitCount((currentCount) => currentCount + 1);
      }

      return (
        <>
          <OtpStepForm
            email="user@example.com"
            isVerifyingOtp={false}
            onOtpChange={setOtp}
            onSubmit={handleSubmit}
            otp={otp}
          />
          <output aria-label="submit-count">{submitCount}</output>
        </>
      );
    }

    render(<TestHarness />);

    fireEvent.change(screen.getByLabelText("One-time code"), {
      target: { value: "123456" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("submit-count").textContent).toBe("1");
    });
  });
});
