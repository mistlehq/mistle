/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { randomUUID } from "node:crypto";

import { createSystemTest, type RuntimeSystemTestEnvironment } from "@mistle/test-harness/system";
import { describe, expect } from "vitest";
import { z } from "zod";

const it = createSystemTest({
  services: ["control-plane-api", "control-plane-worker"],
  extraInfra: ["mailpit"],
});

const AuthOtpLength = 6;

const MembershipCapabilitiesSchema = z
  .object({
    organizationId: z.string().min(1),
    actorRole: z.string().min(1),
  })
  .catchall(z.unknown());

type RuntimeSystemHttpResponse = Awaited<
  ReturnType<RuntimeSystemTestEnvironment["controlPlaneApi"]["http"]["fetch"]>
>;

describe("runtime system auth otp", () => {
  it("signs in with email OTP", async ({ system }) => {
    const email = `runtime-system-auth-otp-smoke-${randomUUID()}@example.com`;

    await sendSignInOtp({ system, email });

    const otp = await waitForSignInOtp({ system, email });
    const signInResponse = await signInWithOtp({
      system,
      email,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const cookie = readRequestCookie(signInResponse);
    const organizationId = await createOrganization({
      system,
      cookie,
      name: "Runtime System OTP Smoke Organization",
      slug: `runtime-system-otp-smoke-${randomUUID()}`,
    });

    const capabilitiesResponse = await system.controlPlaneApi.http.fetch(
      "/v1/organization/membership-capabilities",
      {
        headers: {
          cookie,
        },
      },
    );
    expect(capabilitiesResponse.status).toBe(200);

    const capabilities = MembershipCapabilitiesSchema.parse(await capabilitiesResponse.json());
    expect(capabilities.organizationId).toBe(organizationId);
    expect(capabilities.actorRole).toBe("owner");
  });
});

async function sendSignInOtp(input: {
  system: RuntimeSystemTestEnvironment;
  email: string;
}): Promise<void> {
  const response = await input.system.controlPlaneApi.http.fetch(
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

  expect(response.status).toBe(200);
}

async function waitForSignInOtp(input: {
  system: RuntimeSystemTestEnvironment;
  email: string;
}): Promise<string> {
  const listItem = await input.system.env.mailpit.waitForMessage({
    timeoutMs: 15_000,
    description: `OTP email for ${input.email}`,
    matcher: ({ message }) =>
      message.Subject === "Your Mistle sign-in code" &&
      message.To.some((address) => address.Address === input.email),
  });
  const message = await input.system.env.mailpit.getMessageSummary(listItem.ID);
  const otp = extractOtpCode(message.Text);
  if (otp === undefined) {
    throw new Error("OTP was not found in Mailpit message text.");
  }

  return otp;
}

async function signInWithOtp(input: {
  system: RuntimeSystemTestEnvironment;
  email: string;
  otp: string;
}): Promise<RuntimeSystemHttpResponse> {
  return await input.system.controlPlaneApi.http.fetch("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      otp: input.otp,
    }),
  });
}

function readRequestCookie(response: {
  headers: { get: (name: string) => string | null };
}): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const [cookiePair] = setCookie.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

async function createOrganization(input: {
  system: RuntimeSystemTestEnvironment;
  cookie: string;
  name: string;
  slug: string;
}): Promise<string> {
  const response = await input.system.controlPlaneApi.http.fetch("/v1/auth/organization/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
    },
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
    }),
  });
  expect(response.status).toBe(200);

  const payload: unknown = await response.json().catch(() => null);
  const organizationId = readStringField(payload, "id");
  if (organizationId === null) {
    throw new Error("Expected organization create response to include organization id.");
  }

  return organizationId;
}

function extractOtpCode(text: string): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(AuthOtpLength)}})\\b`, "u");
  const match = text.match(pattern);

  return match?.[1];
}

function readStringField(payload: unknown, field: string): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const value = Reflect.get(payload, field);
  return typeof value === "string" && value.length > 0 ? value : null;
}
