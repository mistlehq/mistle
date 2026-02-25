import { MemberRoles, verifications } from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

import { it } from "./test-context.js";

function extractOTPCode(text: string, otpLength: number): string | undefined {
  const pattern = new RegExp(`\\b(\\d{${String(otpLength)}})\\b`);
  const match = text.match(pattern);

  return match?.[1];
}

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

describe("auth otp integration", () => {
  it("sends OTP, signs in, and bootstraps organization state", async ({ fixture }) => {
    const recipient = "integration-auth-otp@example.com";

    const sendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(sendResponse.status).toBe(200);

    const listItem = await fixture.mailpitService.waitForMessage({
      timeoutMs: 15_000,
      description: `OTP email for ${recipient}`,
      matcher: ({ message }) =>
        message.Subject === "Your sign-in code" &&
        message.To.some((address) => address.Address === recipient),
    });

    const message = await fixture.mailpitService.getMessageSummary(listItem.ID);

    expect(message.Subject).toBe("Your sign-in code");

    const otp = extractOTPCode(message.Text, fixture.config.auth.otpLength);
    expect(otp).toBeDefined();
    if (otp === undefined) {
      throw new Error("OTP was not found in Mailpit message text.");
    }

    expect(message.Text).toContain("expires in 5 minutes");

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
    expect(ownerMembership).toBeDefined();
    if (ownerMembership === undefined) {
      throw new Error("Expected owner membership to exist after OTP sign-in.");
    }

    const organization = await fixture.db.query.organizations.findFirst({
      columns: {
        id: true,
        slug: true,
      },
      where: (organizations, { eq }) => eq(organizations.id, ownerMembership.organizationId),
    });
    expect(organization).toBeDefined();
    if (organization === undefined) {
      throw new Error("Expected organization to exist after OTP sign-in.");
    }
    expect(organization.slug).toBe(organization.id);

    const teams = await fixture.db.query.teams.findMany({
      columns: {
        id: true,
      },
      where: (teams, { eq }) => eq(teams.organizationId, organization.id),
    });
    expect(teams).toHaveLength(1);

    const defaultTeam = teams[0];
    if (defaultTeam === undefined) {
      throw new Error("Expected default team to exist after OTP sign-in.");
    }

    const teamMembership = await fixture.db.query.teamMembers.findFirst({
      columns: {
        id: true,
      },
      where: (teamMembers, { and, eq }) =>
        and(eq(teamMembers.userId, user.id), eq(teamMembers.teamId, defaultTeam.id)),
    });
    expect(teamMembership).toBeDefined();

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
    expect(session.activeOrganizationId).toBe(organization.id);
  }, 60_000);

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

    const listItem = await fixture.mailpitService.waitForMessage({
      timeoutMs: 15_000,
      description: `OTP email for ${recipient}`,
      matcher: ({ message }) =>
        message.Subject === "Your sign-in code" &&
        message.To.some((address) => address.Address === recipient),
    });
    const message = await fixture.mailpitService.getMessageSummary(listItem.ID);

    const otp = extractOTPCode(message.Text, fixture.config.auth.otpLength);
    expect(otp).toBeDefined();
    if (otp === undefined) {
      throw new Error("OTP was not found in Mailpit message text.");
    }

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

    const listItem = await fixture.mailpitService.waitForMessage({
      timeoutMs: 15_000,
      description: `OTP email for ${recipient}`,
      matcher: ({ message }) =>
        message.Subject === "Your sign-in code" &&
        message.To.some((address) => address.Address === recipient),
    });
    const message = await fixture.mailpitService.getMessageSummary(listItem.ID);

    const otp = extractOTPCode(message.Text, fixture.config.auth.otpLength);
    expect(otp).toBeDefined();
    if (otp === undefined) {
      throw new Error("OTP was not found in Mailpit message text.");
    }

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
  }, 60_000);

  it("does not duplicate bootstrap records on repeated sign-ins", async ({ fixture }) => {
    const recipient = "integration-auth-otp-idempotent-bootstrap@example.com";

    const firstSendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(firstSendResponse.status).toBe(200);

    const firstMessageListItem = await fixture.mailpitService.waitForMessage({
      timeoutMs: 15_000,
      description: `first OTP email for ${recipient}`,
      matcher: ({ message }) =>
        message.Subject === "Your sign-in code" &&
        message.To.some((address) => address.Address === recipient),
    });
    const firstMessage = await fixture.mailpitService.getMessageSummary(firstMessageListItem.ID);

    const firstOTP = extractOTPCode(firstMessage.Text, fixture.config.auth.otpLength);
    expect(firstOTP).toBeDefined();
    if (firstOTP === undefined) {
      throw new Error("First OTP was not found in Mailpit message text.");
    }

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
    expect(firstOwnerMemberships).toHaveLength(1);

    const firstOwnerMembership = firstOwnerMemberships[0];
    if (firstOwnerMembership === undefined) {
      throw new Error("Expected owner membership after first sign-in.");
    }

    const firstTeams = await fixture.db.query.teams.findMany({
      columns: {
        id: true,
      },
      where: (teams, { eq }) => eq(teams.organizationId, firstOwnerMembership.organizationId),
    });
    expect(firstTeams).toHaveLength(1);

    const firstTeam = firstTeams[0];
    if (firstTeam === undefined) {
      throw new Error("Expected one default team after first sign-in.");
    }

    const firstTeamMemberships = await fixture.db.query.teamMembers.findMany({
      columns: {
        teamId: true,
      },
      where: (teamMembers, { eq }) => eq(teamMembers.userId, user.id),
    });
    expect(firstTeamMemberships).toHaveLength(1);

    const secondSendResponse = await sendOTPRequest({
      fixture,
      recipient,
    });
    expect(secondSendResponse.status).toBe(200);

    const secondMessageListItem = await fixture.mailpitService.waitForMessage({
      timeoutMs: 15_000,
      description: `second OTP email for ${recipient}`,
      matcher: ({ message }) =>
        message.Subject === "Your sign-in code" &&
        message.ID !== firstMessageListItem.ID &&
        message.To.some((address) => address.Address === recipient),
    });
    const secondMessage = await fixture.mailpitService.getMessageSummary(secondMessageListItem.ID);

    const secondOTP = extractOTPCode(secondMessage.Text, fixture.config.auth.otpLength);
    expect(secondOTP).toBeDefined();
    if (secondOTP === undefined) {
      throw new Error("Second OTP was not found in Mailpit message text.");
    }

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
    expect(secondOwnerMemberships).toHaveLength(1);
    expect(secondOwnerMemberships[0]?.organizationId).toBe(firstOwnerMembership.organizationId);

    const secondTeams = await fixture.db.query.teams.findMany({
      columns: {
        id: true,
      },
      where: (teams, { eq }) => eq(teams.organizationId, firstOwnerMembership.organizationId),
    });
    expect(secondTeams).toHaveLength(1);
    expect(secondTeams[0]?.id).toBe(firstTeam.id);

    const secondTeamMemberships = await fixture.db.query.teamMembers.findMany({
      columns: {
        teamId: true,
      },
      where: (teamMembers, { eq }) => eq(teamMembers.userId, user.id),
    });
    expect(secondTeamMemberships).toHaveLength(1);
    expect(secondTeamMemberships[0]?.teamId).toBe(firstTeam.id);
  }, 60_000);
});
