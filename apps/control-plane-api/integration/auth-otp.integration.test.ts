/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { randomUUID } from "node:crypto";

import { MemberRoles } from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { readLatestSignInOtp } from "../integration/helpers/sign-in-otp.js";
import { MembershipCapabilitiesSchema } from "../src/organizations/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "control-plane-worker"],
  extraInfra: ["mailpit"],
});
const OtpAllowedAttempts = 3;

describe("auth otp integration", () => {
  it("sends OTP, signs in, and leaves organization context empty", async ({ env }) => {
    const email = `integration-new-auth-otp-${randomUUID()}@example.com`;

    await sendOtp({ env, email });

    const receivedMessage = await env.mailpit.waitForMessage({
      timeoutMs: 15_000,
      description: `sign-in OTP email for ${email}`,
      matcher: ({ message }) =>
        message.Subject === "Your Mistle sign-in code" &&
        message.To.some((recipient) => recipient.Address === email),
    });
    const messageSummary = await env.mailpit.getMessageSummary(receivedMessage.ID);
    const otp = await readIssuedOtp({ env, email });
    expect(messageSummary.Text).toContain(otp);

    await signInWithOtp({ env, email, otp });

    const user = await env.controlPlaneDb.query.users.findFirst({
      columns: {
        id: true,
        emailVerified: true,
      },
      where: (table, { eq }) => eq(table.email, email),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected OTP sign-in to create a user.");
    }
    expect(user.emailVerified).toBe(true);

    const ownerMembership = await env.controlPlaneDb.query.members.findFirst({
      columns: {
        organizationId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.userId, user.id), eq(table.role, MemberRoles.OWNER)),
    });
    expect(ownerMembership).toBeUndefined();

    const teamMembership = await env.controlPlaneDb.query.teamMembers.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.userId, user.id),
    });
    expect(teamMembership).toBeUndefined();

    const session = await readLatestSession({ env, userId: user.id });
    expect(session.activeOrganizationId).toBeNull();
  });

  it("uses the issued session cookie against protected organization endpoints after organization creation", async ({
    env,
  }) => {
    const email = `integration-new-auth-otp-protected-${randomUUID()}@example.com`;
    const cookie = await signInAndReadCookie({ env, email });
    const organizationId = await createOrganization({
      env,
      cookie,
      name: "Integration OTP Organization",
      slug: `integration-otp-${randomUUID()}`,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/membership-capabilities",
      {
        headers: {
          cookie,
        },
      },
    );
    expect(response.status).toBe(200);

    const capabilities = MembershipCapabilitiesSchema.parse(await response.json());
    expect(capabilities.organizationId).toBe(organizationId);
    expect(capabilities.actorRole).toBe("owner");
  });

  it("switches the active organization for a user who belongs to more than one organization", async ({
    env,
  }) => {
    const email = `integration-new-auth-otp-switch-org-${randomUUID()}@example.com`;
    const cookie = await signInAndReadCookie({ env, email });
    const firstOrganizationId = await createOrganization({
      env,
      cookie,
      name: "First Switch Organization",
      slug: `integration-switch-first-${randomUUID()}`,
    });
    const secondOrganizationId = await createOrganization({
      env,
      cookie,
      name: "Second Switch Organization",
      slug: `integration-switch-second-${randomUUID()}`,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/auth/organization/set-active", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        organizationId: firstOrganizationId,
      }),
    });
    expect(response.status).toBe(200);

    const user = await readUser({ env, email });
    const session = await readLatestSession({ env, userId: user.id });
    expect(session.activeOrganizationId).toBe(firstOrganizationId);
    expect(session.activeOrganizationId).not.toBe(secondOrganizationId);
  });

  it("does not bootstrap an organization for a newly invited user", async ({ env }) => {
    const inviterSession = await env.auth.createSession({
      email: `integration-new-auth-otp-invite-sender-${randomUUID()}@example.com`,
    });
    const email = `integration-new-auth-otp-invitee-${randomUUID()}@example.com`;

    const inviteResponse = await env.controlPlaneApi.http.fetch(
      "/v1/auth/organization/invite-member",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: inviterSession.cookie,
        },
        body: JSON.stringify({
          organizationId: inviterSession.organizationId,
          email,
          role: "member",
        }),
      },
    );
    expect(inviteResponse.status).toBe(200);

    await signInAndReadCookie({ env, email });

    const user = await readUser({ env, email });
    const ownerMembership = await env.controlPlaneDb.query.members.findFirst({
      columns: {
        organizationId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.userId, user.id), eq(table.role, MemberRoles.OWNER)),
    });
    expect(ownerMembership).toBeUndefined();

    const teamMembership = await env.controlPlaneDb.query.teamMembers.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.userId, user.id),
    });
    expect(teamMembership).toBeUndefined();

    const session = await readLatestSession({ env, userId: user.id });
    expect(session.activeOrganizationId).toBeNull();
  });

  it("rejects sign-in with an incorrect OTP and does not create a user", async ({ env }) => {
    const email = `integration-new-auth-otp-wrong-code-${randomUUID()}@example.com`;

    await sendOtp({ env, email });

    const response = await signInWithOtp({ env, email, otp: "000000" });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('"code":"INVALID_OTP"');

    await expectUserMissing({ env, email });
  });

  it("rejects sign-in when no OTP was issued and does not create a user", async ({ env }) => {
    const email = `integration-new-auth-otp-no-send-${randomUUID()}@example.com`;

    const response = await signInWithOtp({ env, email, otp: "123456" });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('"code":"INVALID_OTP"');

    await expectUserMissing({ env, email });
  });

  it("locks OTP verification after allowed failed attempts", async ({ env }) => {
    const email = `integration-new-auth-otp-attempt-limit-${randomUUID()}@example.com`;

    await sendOtp({ env, email });
    const otp = await readIssuedOtp({ env, email });

    for (let attemptIndex = 0; attemptIndex < OtpAllowedAttempts; attemptIndex += 1) {
      const response = await signInWithOtp({ env, email, otp: "000000" });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain('"code":"INVALID_OTP"');
    }

    const blockedResponse = await signInWithOtp({ env, email, otp });
    expect(blockedResponse.status).toBe(403);
    expect(await blockedResponse.text()).toContain('"code":"TOO_MANY_ATTEMPTS"');

    await expectUserMissing({ env, email });
  });

  it("rejects sign-in with an expired OTP", async ({ env }) => {
    const email = `integration-new-auth-otp-expired-${randomUUID()}@example.com`;
    const identifier = `sign-in-otp-${email.toLowerCase()}`;

    await sendOtp({ env, email });
    const otp = await readIssuedOtp({ env, email });
    const verification = await env.controlPlaneDb.query.verifications.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.identifier, identifier),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
    expect(verification).toBeDefined();
    if (verification === undefined) {
      throw new Error("Expected sign-in OTP verification row to exist.");
    }

    const updatedVerifications = await env.controlPlaneDb
      .update(env.controlPlaneTables.verifications)
      .set({
        expiresAt: new Date(0),
      })
      .where(eq(env.controlPlaneTables.verifications.identifier, identifier))
      .returning({
        id: env.controlPlaneTables.verifications.id,
        expiresAt: env.controlPlaneTables.verifications.expiresAt,
      });
    expect(updatedVerifications.length).toBeGreaterThanOrEqual(1);
    expect(updatedVerifications.every((row) => row.expiresAt.getTime() === 0)).toBe(true);

    const response = await signInWithOtp({ env, email, otp });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('"code":"OTP_EXPIRED"');

    await expectUserMissing({ env, email });
  });

  it("does not create organization bootstrap records on repeated sign-ins", async ({ env }) => {
    const email = `integration-new-auth-otp-idempotent-bootstrap-${randomUUID()}@example.com`;

    await signInAndReadCookie({ env, email });
    const user = await readUser({ env, email });
    await expectNoOrganizationBootstrapRecords({ env, userId: user.id });

    await signInAndReadCookie({ env, email });
    await expectNoOrganizationBootstrapRecords({ env, userId: user.id });
  });
});

type AuthOtpEnvironment = IntegrationTestEnvironment;

async function sendOtp(input: { env: AuthOtpEnvironment; email: string }): Promise<void> {
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

async function signInWithOtp(input: { env: AuthOtpEnvironment; email: string; otp: string }) {
  return await input.env.controlPlaneApi.http.fetch("/v1/auth/sign-in/email-otp", {
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

async function signInAndReadCookie(input: {
  env: AuthOtpEnvironment;
  email: string;
}): Promise<string> {
  await sendOtp(input);
  const otp = await readIssuedOtp(input);
  const response = await signInWithOtp({ ...input, otp });
  expect(response.status).toBe(200);

  return readRequestCookie(response);
}

async function readIssuedOtp(input: { env: AuthOtpEnvironment; email: string }): Promise<string> {
  return await readLatestSignInOtp({
    db: input.env.controlPlaneDb,
    email: input.email,
    otpLength: 6,
  });
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

async function createOrganization(input: {
  env: AuthOtpEnvironment;
  cookie: string;
  name: string;
  slug: string;
}): Promise<string> {
  const response = await input.env.controlPlaneApi.http.fetch("/v1/auth/organization/create", {
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

async function readUser(input: {
  env: AuthOtpEnvironment;
  email: string;
}): Promise<{ id: string }> {
  const user = await input.env.controlPlaneDb.query.users.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.email, input.email),
  });
  if (user === undefined) {
    throw new Error(`Expected user '${input.email}' to exist.`);
  }

  return user;
}

async function readLatestSession(input: {
  env: AuthOtpEnvironment;
  userId: string;
}): Promise<{ activeOrganizationId: string | null }> {
  const session = await input.env.controlPlaneDb.query.sessions.findFirst({
    columns: {
      activeOrganizationId: true,
    },
    where: (table, { eq }) => eq(table.userId, input.userId),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (session === undefined) {
    throw new Error(`Expected latest session to exist for user '${input.userId}'.`);
  }

  return session;
}

async function expectUserMissing(input: { env: AuthOtpEnvironment; email: string }): Promise<void> {
  const user = await input.env.controlPlaneDb.query.users.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.email, input.email),
  });
  expect(user).toBeUndefined();
}

async function expectNoOrganizationBootstrapRecords(input: {
  env: AuthOtpEnvironment;
  userId: string;
}): Promise<void> {
  const ownerMemberships = await input.env.controlPlaneDb.query.members.findMany({
    columns: {
      organizationId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.userId, input.userId), eq(table.role, MemberRoles.OWNER)),
  });
  expect(ownerMemberships).toHaveLength(0);

  const teamMemberships = await input.env.controlPlaneDb.query.teamMembers.findMany({
    columns: {
      teamId: true,
    },
    where: (table, { eq }) => eq(table.userId, input.userId),
  });
  expect(teamMemberships).toHaveLength(0);

  const session = await readLatestSession(input);
  expect(session.activeOrganizationId).toBeNull();
}

function readStringField(payload: unknown, field: string): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const value = Reflect.get(payload, field);
  return typeof value === "string" && value.length > 0 ? value : null;
}
