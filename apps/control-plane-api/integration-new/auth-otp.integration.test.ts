/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { randomUUID } from "node:crypto";

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { readLatestSignInOtp } from "../integration/helpers/sign-in-otp.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "control-plane-worker"],
  extraInfra: ["mailpit"],
});

describe.concurrent("auth otp integration", () => {
  it("sends the sign-in OTP through the control-plane worker", async ({ env }) => {
    const email = `integration-new-auth-otp-${randomUUID()}@example.com`;

    const sendResponse = await env.controlPlaneApi.http.fetch(
      "/v1/auth/email-otp/send-verification-otp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          type: "sign-in",
        }),
      },
    );
    expect(sendResponse.status).toBe(200);

    const receivedMessage = await env.mailpit.waitForMessage({
      timeoutMs: 15_000,
      description: `sign-in OTP email for ${email}`,
      matcher: ({ message }) =>
        message.Subject === "Your Mistle sign-in code" &&
        message.To.some((recipient) => recipient.Address === email),
    });
    const messageSummary = await env.mailpit.getMessageSummary(receivedMessage.ID);

    const otp = await readLatestSignInOtp({
      db: env.controlPlaneDb,
      email,
      otpLength: 6,
    });
    expect(messageSummary.Text).toContain(otp);

    const signInResponse = await env.controlPlaneApi.http.fetch("/v1/auth/sign-in/email-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        otp,
      }),
    });
    expect(signInResponse.status).toBe(200);

    const user = await env.controlPlaneDb.query.users.findFirst({
      columns: {
        emailVerified: true,
      },
      where: (table, { eq }) => eq(table.email, email),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected OTP sign-in to create a user.");
    }
    expect(user.emailVerified).toBe(true);
  });
});
