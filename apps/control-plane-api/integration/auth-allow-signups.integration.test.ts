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
  __serviceOptions: {
    controlPlaneApi: {
      allowSignups: false,
    },
  },
});

describe.concurrent("auth signup allowance integration", () => {
  it("rejects OTP sign-in for an unknown email when signups are disabled", async ({ env }) => {
    const email = `integration-disabled-otp-new-${randomUUID()}@example.com`;

    const sendResponse = await sendOtp({ env, email });
    expect(sendResponse.status).toBe(200);

    const verification = await env.controlPlaneDb.query.verifications.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.identifier, `sign-in-otp-${email.toLowerCase()}`),
    });
    expect(verification).toBeUndefined();

    const response = await signInWithOtp({ env, email, otp: "123456" });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('"code":"INVALID_OTP"');

    await expectUserMissing({ env, email });
  });

  it("allows OTP sign-in for an existing user when signups are disabled", async ({ env }) => {
    const email = `integration-disabled-otp-existing-${randomUUID()}@example.com`;
    await createExistingUser({ env, email });

    const sendResponse = await sendOtp({ env, email });
    expect(sendResponse.status).toBe(200);
    const otp = await readLatestSignInOtp({
      db: env.controlPlaneDb,
      email,
      otpLength: 6,
    });

    const response = await signInWithOtp({ env, email, otp });
    expect(response.status).toBe(200);

    const user = await readUserByEmail({ env, email });
    expect(user.emailVerified).toBe(true);
  });

  it("rejects Google sign-in for an unknown email when signups are disabled", async ({ env }) => {
    const email = `integration-disabled-google-new-${randomUUID()}@example.com`;

    const response = await signInWithGoogleIdToken({
      env,
      email,
      emailVerified: true,
      googleAccountId: "disabled-google-new",
    });
    expect(response.status).toBe(401);

    await expectUserMissing({ env, email });
  });

  it("rejects explicit Google signup requests when signups are disabled", async ({ env }) => {
    const email = `integration-disabled-google-request-signup-${randomUUID()}@example.com`;

    const response = await signInWithGoogleIdToken({
      env,
      email,
      emailVerified: true,
      googleAccountId: "disabled-google-request-signup",
      requestSignUp: true,
    });
    expect(response.status).toBe(401);

    await expectUserMissing({ env, email });
  });

  it("allows Google sign-in to link an existing verified user when signups are disabled", async ({
    env,
  }) => {
    const email = `integration-disabled-google-existing-${randomUUID()}@example.com`;
    const existingUser = await createExistingUser({ env, email });

    const response = await signInWithGoogleIdToken({
      env,
      email,
      emailVerified: true,
      googleAccountId: "disabled-google-existing",
    });
    expect(response.status).toBe(200);

    const linkedGoogleAccount = await env.controlPlaneDb.query.accounts.findFirst({
      columns: {
        userId: true,
        providerId: true,
        accountId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.providerId, "google"), eq(table.accountId, "disabled-google-existing")),
    });
    expect(linkedGoogleAccount).toEqual({
      userId: existingUser.id,
      providerId: "google",
      accountId: "disabled-google-existing",
    });
  });
});

async function createExistingUser(input: {
  env: IntegrationTestEnvironment;
  email: string;
}): Promise<{ id: string; email: string; emailVerified: boolean }> {
  const createdUsers = await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.users)
    .values({
      name: "Existing User",
      email: input.email,
      emailVerified: true,
    })
    .returning({
      id: input.env.controlPlaneTables.users.id,
      email: input.env.controlPlaneTables.users.email,
      emailVerified: input.env.controlPlaneTables.users.emailVerified,
    });
  const [user] = createdUsers;
  if (user === undefined) {
    throw new Error(`Expected user '${input.email}' to be created.`);
  }

  return user;
}

async function sendOtp(input: { env: IntegrationTestEnvironment; email: string }) {
  return input.env.controlPlaneApi.http.fetch("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      type: "sign-in",
    }),
  });
}

async function signInWithOtp(input: {
  env: IntegrationTestEnvironment;
  email: string;
  otp: string;
}) {
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

async function signInWithGoogleIdToken(input: {
  env: IntegrationTestEnvironment;
  email: string;
  emailVerified: boolean;
  googleAccountId: string;
  requestSignUp?: boolean;
}) {
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
      ...(input.requestSignUp === undefined ? {} : { requestSignUp: input.requestSignUp }),
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

async function readUserByEmail(input: {
  env: IntegrationTestEnvironment;
  email: string;
}): Promise<{ id: string; email: string; emailVerified: boolean }> {
  const user = await input.env.controlPlaneDb.query.users.findFirst({
    columns: {
      id: true,
      email: true,
      emailVerified: true,
    },
    where: (table, { eq }) => eq(table.email, input.email),
  });
  if (user === undefined) {
    throw new Error(`Expected user '${input.email}' to exist.`);
  }

  return user;
}

async function expectUserMissing(input: {
  env: IntegrationTestEnvironment;
  email: string;
}): Promise<void> {
  const user = await input.env.controlPlaneDb.query.users.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.email, input.email),
  });
  expect(user).toBeUndefined();
}
