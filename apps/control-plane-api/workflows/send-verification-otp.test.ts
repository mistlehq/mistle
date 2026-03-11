import { describe, expect, it } from "vitest";

import { SendVerificationOTPWorkflow } from "./send-verification-otp.js";

describe("send verification otp workflow scaffold", () => {
  it("exports the expected workflow spec metadata", () => {
    expect(SendVerificationOTPWorkflow.spec.name).toBe("control-plane.auth.send-verification-otp");
    expect(SendVerificationOTPWorkflow.spec.version).toBe("1");
  });
});
