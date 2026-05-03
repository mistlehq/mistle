/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { readLatestSignInOtp } from "../integration/helpers/sign-in-otp.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  auth: {
    google: "simulated",
  },
});

describe.concurrent("auth google linking integration", () => {
  it("links google sign-in to an existing OTP user with the same verified email", async ({
    env,
  }) => {
    const email = `integration-new-google-existing-otp-${randomUUID()}@example.com`;
    const otpSession = await env.auth.createSession({ email });

    const response = await signInWithGoogleIdToken({
      env,
      email,
      emailVerified: true,
      googleAccountId: "google-existing-otp",
    });
    expect(response.status).toBe(200);

    const users = await env.controlPlaneDb.query.users.findMany({
      columns: {
        id: true,
        email: true,
      },
      where: (table, { eq }) => eq(table.email, email),
    });
    expect(users).toEqual([
      {
        id: otpSession.userId,
        email,
      },
    ]);

    const linkedGoogleAccount = await env.controlPlaneDb.query.accounts.findFirst({
      columns: {
        userId: true,
        providerId: true,
        accountId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.providerId, "google"), eq(table.accountId, "google-existing-otp")),
    });
    expect(linkedGoogleAccount).toEqual({
      userId: otpSession.userId,
      providerId: "google",
      accountId: "google-existing-otp",
    });
  });

  it("reuses the google-linked user when signing in later with OTP", async ({ env }) => {
    const email = `integration-new-google-existing-google-${randomUUID()}@example.com`;

    const googleResponse = await signInWithGoogleIdToken({
      env,
      email,
      emailVerified: true,
      googleAccountId: "google-existing-google",
    });
    expect(googleResponse.status).toBe(200);

    const googleUser = await readUserByEmail({ env, email });

    await sendOtp({ env, email });
    const otp = await readLatestSignInOtp({
      db: env.controlPlaneDb,
      email,
      otpLength: 6,
    });
    const otpResponse = await signInWithOtp({ env, email, otp });
    expect(otpResponse.status).toBe(200);

    const users = await env.controlPlaneDb.query.users.findMany({
      columns: {
        id: true,
        email: true,
      },
      where: (table, { eq }) => eq(table.email, email),
    });
    expect(users).toEqual([
      {
        id: googleUser.id,
        email,
      },
    ]);
  });

  it("does not link an unverified google email to an existing OTP user", async ({ env }) => {
    const email = `integration-new-google-unverified-${randomUUID()}@example.com`;
    const otpSession = await env.auth.createSession({ email });

    const response = await signInWithGoogleIdToken({
      env,
      email,
      emailVerified: false,
      googleAccountId: "google-unverified",
    });
    expect(response.status).toBe(401);

    const users = await env.controlPlaneDb.query.users.findMany({
      columns: {
        id: true,
        email: true,
      },
      where: (table, { eq }) => eq(table.email, email),
    });
    expect(users).toEqual([
      {
        id: otpSession.userId,
        email,
      },
    ]);

    const linkedGoogleAccount = await env.controlPlaneDb.query.accounts.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.providerId, "google"), eq(table.accountId, "google-unverified")),
    });
    expect(linkedGoogleAccount).toBeUndefined();
  });
});

async function signInWithGoogleIdToken(input: {
  env: IntegrationTestEnvironment;
  email: string;
  emailVerified: boolean;
  googleAccountId: string;
}): Promise<Response> {
  // This exercises Better Auth's real `/sign-in/social` id-token path. The
  // simulated token payload mirrors Google OpenID Connect claims documented at
  // https://developers.google.com/identity/openid-connect/openid-connect and
  // consumed by Better Auth's Google provider.
  return input.env.controlPlaneApi.http.fetch("/v1/auth/sign-in/social", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: "google",
      callbackURL: "http://localhost:5173/auth/login/callback?redirectTo=%2F",
      idToken: {
        token: encodeGoogleIdToken({
          aud: "integration-new-google-client-id",
          email: input.email,
          email_verified: input.emailVerified,
          exp: Math.floor(Date.now() / 1000) + 300,
          iss: "https://accounts.google.com",
          name: "Integration Google User",
          picture: "https://lh3.googleusercontent.com/integration-new-avatar",
          sub: input.googleAccountId,
        }),
        accessToken: `access-token-${input.googleAccountId}`,
        refreshToken: `refresh-token-${input.googleAccountId}`,
      },
    }),
  });
}

function encodeGoogleIdToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${header}.${encodedPayload}.`;
}

async function sendOtp(input: { env: IntegrationTestEnvironment; email: string }): Promise<void> {
  const response = await input.env.controlPlaneApi.http.fetch(
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

async function signInWithOtp(input: {
  env: IntegrationTestEnvironment;
  email: string;
  otp: string;
}): Promise<Response> {
  return input.env.controlPlaneApi.http.fetch("/v1/auth/sign-in/email-otp", {
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

async function readUserByEmail(input: {
  env: IntegrationTestEnvironment;
  email: string;
}): Promise<{ id: string; email: string }> {
  const user = await input.env.controlPlaneDb.query.users.findFirst({
    columns: {
      id: true,
      email: true,
    },
    where: (table, { eq }) => eq(table.email, input.email),
  });
  if (user === undefined) {
    throw new Error(`Expected user '${input.email}' to exist.`);
  }

  return user;
}
