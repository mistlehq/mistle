import { describe, expect } from "vitest";

import { SendVerificationOTPWorkflowSpec } from "../../src/control-plane/index.js";
import { it } from "./test-context.js";

describe("send verification otp workflow integration", () => {
  it("runs the workflow and sends an OTP email via SMTP", async ({ fixture }) => {
    const recipient = "workflow-otp@mistle.dev";
    const handle = await fixture.openWorkflow.runWorkflow(SendVerificationOTPWorkflowSpec, {
      email: recipient,
      otp: "123456",
      type: "sign-in",
      expiresInSeconds: 300,
    });
    const result = await handle.result({ timeoutMs: 10_000 });

    expect(result.messageId).not.toBe("");

    const message = await fixture.mailpitService.waitForMessage({
      timeoutMs: 10_000,
      description: `workflow OTP email for ${recipient}`,
      matcher: ({ message: listMessage }) =>
        listMessage.Subject === "Your sign-in code" &&
        listMessage.To.some((address) => address.Address === recipient),
    });

    expect(message.Subject).toBe("Your sign-in code");
    expect(message.To.map((address) => address.Address)).toContain(recipient);
  }, 90_000);
});
