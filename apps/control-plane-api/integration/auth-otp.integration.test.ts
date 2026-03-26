import { randomUUID } from "node:crypto";

import { MemberRoles, members, verifications } from "@mistle/db/control-plane";
import { SendVerificationOTPWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { MembershipCapabilitiesSchema } from "../src/organizations/index.js";
import { readLatestSignInOtp } from "./helpers/sign-in-otp.js";
import { countControlPlaneWorkflowRuns } from "./helpers/workflow-runs.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

async function sendOTPRequest(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
}): Promise<Response> {
  return input.fixture.request("/v1/auth/email-otp/send-verification-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.recipient,
      type: "sign-in",
    }),
  });
}

async function signInWithOTP(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
  otp: string;
}): Promise<Response> {
  return input.fixture.request("/v1/auth/sign-in/email-otp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: input.recipient,
      otp: input.otp,
    }),
  });
}

async function readIssuedOtp(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  recipient: string;
}): Promise<string> {
  return readLatestSignInOtp({
    db: input.fixture.db,
    email: input.recipient,
    otpLength: input.fixture.config.auth.otpLength,
  });
}

function extractRequestCookie(signInResponse: Response): string {
  const setCookie = signInResponse.headers.get("set-cookie");
  if (typeof setCookie !== "string" || setCookie.length === 0) {
    throw new Error("Expected sign-in response to include set-cookie.");
  }

  const [cookiePair] = setCookie.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected sign-in response to include a usable cookie value.");
  }

  return cookiePair;
}

function readOrganizationIdFromPayload(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const id = Reflect.get(payload, "id");
  return typeof id === "string" && id.length > 0 ? id : null;
}

describe("auth otp integration", () => {
  it("sends OTP, signs in, and leaves organization context empty", async ({ fixture }) => {
    const recipient = "integration-auth-otp@example.com";
    const workflowRunCountBefore = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SendVerificationOTPWorkflowSpec.name,
      inputEquals: {
        email: recipient,
        type: "sign-in",
      },
    });

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const workflowRunCountAfter = await countControlPlaneWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      workflowName: SendVerificationOTPWorkflowSpec.name,
      inputEquals: {
        email: recipient,
        type: "sign-in",
      },
    });
    expect(workflowRunCountAfter).toBe(workflowRunCountBefore + 1);

    const otp = await readIssuedOtp({
      fixture,
      recipient,
    });

    const signInResponse = await signInWithOTP({
      fixture,
      recipient,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
        emailVerified: true,
      },
      where: (users, { eq }) => eq(users.email, recipient),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected user to be created after OTP sign-in.");
    }
    expect(user.emailVerified).toBe(true);

    const ownerMembership = await fixture.db.query.members.findFirst({
      columns: {
        organizationId: true,
      },
      where: (members, { and, eq }) =>
        and(eq(members.userId, user.id), eq(members.role, MemberRoles.OWNER)),
    });
    expect(ownerMembership).toBeUndefined();

    const teamMembership = await fixture.db.query.teamMembers.findFirst({
      columns: {
        id: true,
      },
      where: (teamMembers, { eq }) => eq(teamMembers.userId, user.id),
    });
    expect(teamMembership).toBeUndefined();

    const session = await fixture.db.query.sessions.findFirst({
      columns: {
        activeOrganizationId: true,
      },
      where: (sessions, { eq }) => eq(sessions.userId, user.id),
      orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
    });
    expect(session).toBeDefined();
    if (session === undefined) {
      throw new Error("Expected session to exist after OTP sign-in.");
    }
    expect(session.activeOrganizationId).toBeNull();
  });

  it("uses the issued session cookie against protected organization endpoints after organization creation", async ({
    fixture,
  }) => {
    const recipient = `integration-auth-otp-protected-${randomUUID()}@example.com`;

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const otp = await readIssuedOtp({
      fixture,
      recipient,
    });

    const signInResponse = await signInWithOTP({
      fixture,
      recipient,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const requestCookie = extractRequestCookie(signInResponse);

    const createOrganizationResponse = await fixture.request("/v1/auth/organization/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: requestCookie,
      },
      body: JSON.stringify({
        name: "Integration OTP Organization",
        slug: `integration-otp-${randomUUID()}`,
      }),
    });
    expect(createOrganizationResponse.status).toBe(200);

    const createOrganizationPayload: unknown = await createOrganizationResponse
      .json()
      .catch(() => null);
    const organizationId = readOrganizationIdFromPayload(createOrganizationPayload);
    expect(organizationId).not.toBeNull();
    if (organizationId === null) {
      throw new Error("Expected organization create response to include organization id.");
    }

    const capabilitiesResponse = await fixture.request(
      `/v1/organizations/${encodeURIComponent(organizationId)}/membership-capabilities`,
      {
        headers: {
          cookie: requestCookie,
        },
      },
    );
    expect(capabilitiesResponse.status).toBe(200);

    const capabilities = MembershipCapabilitiesSchema.parse(await capabilitiesResponse.json());
    expect(capabilities.organizationId).toBe(organizationId);
    expect(capabilities.actorRole).toBe("owner");
  });

  it("does not bootstrap an organization for a newly invited user", async ({ fixture }) => {
    const inviterSession = await fixture.authSession({
      email: "integration-auth-otp-pending-invite-sender@example.com",
    });
    const recipient = `integration-auth-otp-pending-invite-${randomUUID()}@example.com`;

    const inviteResponse = await fixture.request("/v1/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: inviterSession.cookie,
      },
      body: JSON.stringify({
        organizationId: inviterSession.organizationId,
        email: recipient,
        role: "member",
      }),
    });
    expect(inviteResponse.status).toBe(200);

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const otp = await readIssuedOtp({
      fixture,
      recipient,
    });

    const signInResponse = await signInWithOTP({
      fixture,
      recipient,
      otp,
    });
    expect(signInResponse.status).toBe(200);

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq: eqUsers }) => eqUsers(users.email, recipient),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected user to be created after OTP sign-in.");
    }

    const ownerMembership = await fixture.db.query.members.findFirst({
      columns: {
        organizationId: true,
      },
      where: (members, { and, eq: eqMembers }) =>
        and(eqMembers(members.userId, user.id), eqMembers(members.role, MemberRoles.OWNER)),
    });
    expect(ownerMembership).toBeUndefined();

    const teamMembership = await fixture.db.query.teamMembers.findFirst({
      columns: {
        id: true,
      },
      where: (teamMembers, { eq: eqTeamMembers }) => eqTeamMembers(teamMembers.userId, user.id),
    });
    expect(teamMembership).toBeUndefined();

    const session = await fixture.db.query.sessions.findFirst({
      columns: {
        activeOrganizationId: true,
      },
      where: (sessions, { eq: eqSessions }) => eqSessions(sessions.userId, user.id),
      orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
    });
    expect(session).toBeDefined();
    if (session === undefined) {
      throw new Error("Expected session to exist after OTP sign-in.");
    }
    expect(session.activeOrganizationId).toBeNull();
  });

  it("rejects sign-in with an incorrect OTP and does not create a user", async ({ fixture }) => {
    const recipient = "integration-auth-otp-wrong-code@example.com";

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const wrongOTPResponse = await signInWithOTP({
      fixture,
      recipient,
      otp: "000000",
    });
    expect(wrongOTPResponse.status).toBe(400);

    const wrongOTPBody = await wrongOTPResponse.text();
    expect(wrongOTPBody).toContain('"code":"INVALID_OTP"');
    expect(wrongOTPBody).toContain('"message":"Invalid OTP"');

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq }) => eq(users.email, recipient),
    });
    expect(user).toBeUndefined();
  });

  it("rejects sign-in when no OTP was issued and does not create a user", async ({ fixture }) => {
    const recipient = "integration-auth-otp-no-send@example.com";

    const signInResponse = await signInWithOTP({
      fixture,
      recipient,
      otp: "123456",
    });
    expect(signInResponse.status).toBe(400);

    const signInBody = await signInResponse.text();
    expect(signInBody).toContain('"code":"INVALID_OTP"');
    expect(signInBody).toContain('"message":"Invalid OTP"');

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq }) => eq(users.email, recipient),
    });
    expect(user).toBeUndefined();
  });

  it("locks OTP verification after allowed failed attempts", async ({ fixture }) => {
    const recipient = "integration-auth-otp-attempt-limit@example.com";

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const otp = await readIssuedOtp({
      fixture,
      recipient,
    });

    for (
      let attemptIndex = 0;
      attemptIndex < fixture.config.auth.otpAllowedAttempts;
      attemptIndex += 1
    ) {
      const invalidAttemptResponse = await signInWithOTP({
        fixture,
        recipient,
        otp: "000000",
      });
      expect(invalidAttemptResponse.status).toBe(400);

      const invalidAttemptBody = await invalidAttemptResponse.text();
      expect(invalidAttemptBody).toContain('"code":"INVALID_OTP"');
      expect(invalidAttemptBody).toContain('"message":"Invalid OTP"');
    }

    const blockedResponse = await signInWithOTP({
      fixture,
      recipient,
      otp,
    });
    expect(blockedResponse.status).toBe(403);

    const blockedBody = await blockedResponse.text();
    expect(blockedBody).toContain('"code":"TOO_MANY_ATTEMPTS"');
    expect(blockedBody).toContain('"message":"Too many attempts"');

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq }) => eq(users.email, recipient),
    });
    expect(user).toBeUndefined();
  });

  it("rejects sign-in with an expired OTP", async ({ fixture }) => {
    const recipient = "integration-auth-otp-expired@example.com";

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const otp = await readIssuedOtp({
      fixture,
      recipient,
    });

    const verificationIdentifier = `sign-in-otp-${recipient}`;
    const verification = await fixture.db.query.verifications.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.identifier, verificationIdentifier),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
    expect(verification).toBeDefined();
    if (verification === undefined) {
      throw new Error("Expected sign-in OTP verification row to exist.");
    }

    const updatedVerifications = await fixture.db
      .update(verifications)
      .set({
        expiresAt: new Date(0),
      })
      .where(eq(verifications.id, verification.id))
      .returning({
        id: verifications.id,
      });
    expect(updatedVerifications).toHaveLength(1);

    const expiredResponse = await signInWithOTP({
      fixture,
      recipient,
      otp,
    });
    expect(expiredResponse.status).toBe(400);

    const expiredBody = await expiredResponse.text();
    expect(expiredBody).toContain('"code":"OTP_EXPIRED"');
    expect(expiredBody).toContain('"message":"OTP expired"');

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq }) => eq(users.email, recipient),
    });
    expect(user).toBeUndefined();
  });

  it("does not create organization bootstrap records on repeated sign-ins", async ({ fixture }) => {
    const recipient = "integration-auth-otp-idempotent-bootstrap@example.com";

    const firstSendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(firstSendResponse.status).toBe(200);

    const firstOTP = await readIssuedOtp({
      fixture,
      recipient,
    });

    const firstSignInResponse = await signInWithOTP({
      fixture,
      recipient,
      otp: firstOTP,
    });
    expect(firstSignInResponse.status).toBe(200);

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (users, { eq }) => eq(users.email, recipient),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected user to exist after the first sign-in.");
    }

    const firstOwnerMemberships = await fixture.db.query.members.findMany({
      columns: {
        organizationId: true,
      },
      where: (members, { and, eq }) =>
        and(eq(members.userId, user.id), eq(members.role, MemberRoles.OWNER)),
    });
    expect(firstOwnerMemberships).toHaveLength(0);

    const firstTeams = await fixture.db.query.teams.findMany({
      columns: {
        id: true,
      },
      where: (teams, { inArray }) =>
        inArray(
          teams.organizationId,
          fixture.db
            .select({
              organizationId: members.organizationId,
            })
            .from(members)
            .where(eq(members.userId, user.id)),
        ),
    });
    expect(firstTeams).toHaveLength(0);

    const firstTeamMemberships = await fixture.db.query.teamMembers.findMany({
      columns: {
        teamId: true,
      },
      where: (teamMembers, { eq }) => eq(teamMembers.userId, user.id),
    });
    expect(firstTeamMemberships).toHaveLength(0);

    const firstSession = await fixture.db.query.sessions.findFirst({
      columns: {
        activeOrganizationId: true,
      },
      where: (sessions, { eq }) => eq(sessions.userId, user.id),
      orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
    });
    expect(firstSession).toBeDefined();
    if (firstSession === undefined) {
      throw new Error("Expected session to exist after first sign-in.");
    }
    expect(firstSession.activeOrganizationId).toBeNull();

    const secondSendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(secondSendResponse.status).toBe(200);

    const secondOTP = await readIssuedOtp({
      fixture,
      recipient,
    });

    const secondSignInResponse = await signInWithOTP({
      fixture,
      recipient,
      otp: secondOTP,
    });
    expect(secondSignInResponse.status).toBe(200);

    const secondOwnerMemberships = await fixture.db.query.members.findMany({
      columns: {
        organizationId: true,
      },
      where: (members, { and, eq }) =>
        and(eq(members.userId, user.id), eq(members.role, MemberRoles.OWNER)),
    });
    expect(secondOwnerMemberships).toHaveLength(0);

    const secondTeams = await fixture.db.query.teams.findMany({
      columns: {
        id: true,
      },
      where: (teams, { inArray }) =>
        inArray(
          teams.organizationId,
          fixture.db
            .select({
              organizationId: members.organizationId,
            })
            .from(members)
            .where(eq(members.userId, user.id)),
        ),
    });
    expect(secondTeams).toHaveLength(0);

    const secondTeamMemberships = await fixture.db.query.teamMembers.findMany({
      columns: {
        teamId: true,
      },
      where: (teamMembers, { eq }) => eq(teamMembers.userId, user.id),
    });
    expect(secondTeamMemberships).toHaveLength(0);

    const secondSession = await fixture.db.query.sessions.findFirst({
      columns: {
        activeOrganizationId: true,
      },
      where: (sessions, { eq }) => eq(sessions.userId, user.id),
      orderBy: (sessions, { desc }) => [desc(sessions.createdAt)],
    });
    expect(secondSession).toBeDefined();
    if (secondSession === undefined) {
      throw new Error("Expected session to exist after second sign-in.");
    }
    expect(secondSession.activeOrganizationId).toBeNull();
  });
});
