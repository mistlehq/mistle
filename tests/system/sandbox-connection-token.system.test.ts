import { randomUUID } from "node:crypto";

import type { SystemEnvironment } from "@mistle/test-environments";
import { startSystemEnvironment } from "@mistle/test-environments";
import { verifyBootstrapToken } from "@mistle/tunnel-auth";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

type AuthenticatedSession = {
  cookie: string;
  organizationId: string;
};

type MailpitMessageSummary = {
  Subject: string;
  To: Array<{
    Address: string;
  }>;
};

const IntegrationOtpLength = 6;
const IntegrationBootstrapTokenConfig = {
  bootstrapTokenSecret: "integration-bootstrap-secret",
  tokenIssuer: "integration-issuer",
  tokenAudience: "integration-audience",
} as const;
const IntegrationGatewayWsUrl = "ws://127.0.0.1:5202/tunnel/sandbox";

function extractOTPCode(text: string, otpLength: number): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(otpLength)}})\\b`);
  const match = text.match(pattern);

  return match?.[1];
}

function extractRequestCookie(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

function readStringField(payload: unknown, field: string): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error(`Expected response payload object for field '${field}'.`);
  }

  const value = Reflect.get(payload, field);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty string field '${field}'.`);
  }

  return value;
}

function readConnection(payload: unknown): { url: string; token: string; expiresAt: string } {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Expected response payload object with connection field.");
  }

  const connection = Reflect.get(payload, "connection");
  if (typeof connection !== "object" || connection === null) {
    throw new Error("Expected response payload to include connection object.");
  }

  const url = readStringField(connection, "url");
  const token = readStringField(connection, "token");
  const expiresAt = readStringField(connection, "expiresAt");

  return {
    url,
    token,
    expiresAt,
  };
}

async function createAuthenticatedSession(
  environment: SystemEnvironment,
): Promise<AuthenticatedSession> {
  const email = `system-auth-${randomUUID()}@example.com`;

  const sendResponse = await environment.requestControlPlane(
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

  const listItem = await environment.mailpitService.waitForMessage({
    timeoutMs: 15_000,
    description: `OTP email for ${email}`,
    matcher: ({ message }: { message: MailpitMessageSummary }) =>
      message.Subject === "Your sign-in code" &&
      message.To.some((address) => address.Address === email),
  });
  const message = await environment.mailpitService.getMessageSummary(listItem.ID);
  const otp = extractOTPCode(message.Text, IntegrationOtpLength);
  if (otp === undefined) {
    throw new Error("OTP was not found in Mailpit message text.");
  }

  const signInResponse = await environment.requestControlPlane("/v1/auth/sign-in/email-otp", {
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

  const setCookie = signInResponse.headers.get("set-cookie");
  if (typeof setCookie !== "string" || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const cookie = extractRequestCookie(setCookie);

  const createOrganizationResponse = await environment.requestControlPlane(
    "/v1/auth/organization/create",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "System Test Organization",
        slug: `system-${randomUUID()}`,
      }),
    },
  );
  expect(createOrganizationResponse.status).toBe(200);
  const createOrganizationPayload: unknown = await createOrganizationResponse.json();
  const organizationId = readStringField(createOrganizationPayload, "id");

  return {
    cookie,
    organizationId,
  };
}

describe("sandbox connection token system", () => {
  let environment: SystemEnvironment;

  beforeAll(async () => {
    environment = await startSystemEnvironment();
  }, 120_000);

  afterAll(async () => {
    await environment.stop();
  });

  test("issues a bootstrap connection token when requested on profile instance start", async () => {
    const authenticatedSession = await createAuthenticatedSession(environment);
    expect(authenticatedSession.organizationId).not.toBe("");

    const createProfileResponse = await environment.requestControlPlane("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: "System Token Profile",
      }),
    });
    expect(createProfileResponse.status).toBe(201);
    const createdProfilePayload: unknown = await createProfileResponse.json();
    const profileId = readStringField(createdProfilePayload, "id");

    const startInstanceResponse = await environment.requestControlPlane(
      `/v1/sandbox/profiles/${profileId}/versions/1/instances`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          issueConnectionToken: true,
        }),
      },
    );
    expect(startInstanceResponse.status).toBe(201);

    const startedInstancePayload: unknown = await startInstanceResponse.json();
    const sandboxInstanceId = readStringField(startedInstancePayload, "sandboxInstanceId");
    const connection = readConnection(startedInstancePayload);

    const connectionUrl = new URL(connection.url);
    expect(`${connectionUrl.protocol}//${connectionUrl.host}${connectionUrl.pathname}`).toBe(
      IntegrationGatewayWsUrl,
    );
    expect(connectionUrl.searchParams.get("token")).toBe(connection.token);

    const verifiedToken = await verifyBootstrapToken({
      config: IntegrationBootstrapTokenConfig,
      token: connection.token,
    });
    expect(verifiedToken.jti.startsWith(`${sandboxInstanceId}-`)).toBe(true);

    const expiresAtEpochMs = Date.parse(connection.expiresAt);
    expect(Number.isNaN(expiresAtEpochMs)).toBe(false);
    const remainingTtlMs = expiresAtEpochMs - Date.now();
    expect(remainingTtlMs).toBeGreaterThan(20_000);
    expect(remainingTtlMs).toBeLessThanOrEqual(130_000);
  }, 120_000);
});
