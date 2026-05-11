/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { readLatestSignInOtp } from "./helpers/sign-in-otp.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  auth: {
    selfServiceOrganizationCreation: "disabled",
  },
});

describe.concurrent("auth organization creation disabled integration", () => {
  it("rejects public self-service organization creation when disabled", async ({ env }) => {
    const cookie = await signInAndReadCookie({
      env,
      email: `integration-org-create-disabled-${randomUUID()}@example.com`,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/auth/organization/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "Disabled Organization",
        slug: `disabled-${randomUUID()}`,
      }),
    });

    expect(response.status).toBe(403);
  });
});

async function signInAndReadCookie(input: {
  env: IntegrationTestEnvironment;
  email: string;
}): Promise<string> {
  const sendResponse = await input.env.controlPlaneApi.http.fetch(
    "/v1/auth/email-otp/send-verification-otp",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        type: "sign-in",
      }),
    },
  );
  expect(sendResponse.status).toBe(200);

  const otp = await readLatestSignInOtp({
    db: input.env.controlPlaneDb,
    email: input.email,
    otpLength: 6,
  });

  const signInResponse = await input.env.controlPlaneApi.http.fetch("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      otp,
    }),
  });
  expect(signInResponse.status).toBe(200);

  return readRequestCookie(signInResponse);
}

function readRequestCookie(response: {
  headers: { get: (name: string) => string | null };
}): string {
  const setCookie = response.headers.get("set-cookie");
  if (typeof setCookie !== "string" || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const [cookiePair] = setCookie.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}
