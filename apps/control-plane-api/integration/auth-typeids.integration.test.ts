import { randomUUID } from "node:crypto";

import { describe, expect } from "vitest";

import { readLatestSignInOtp } from "./helpers/sign-in-otp.js";
import { it } from "./test-context.js";

function expectTypeIdPrefix(identifier: string, prefix: string): void {
  expect(identifier).toMatch(new RegExp(`^${prefix}_[0-9a-z]{26}$`, "u"));
}

function extractRequestCookie(setCookieHeader: string): string {
  const [cookiePair] = setCookieHeader.split(";");
  if (cookiePair === undefined || cookiePair.length === 0) {
    throw new Error("Expected auth response to include a usable cookie value.");
  }

  return cookiePair;
}

describe("auth typeids integration", () => {
  it("persists auth and organization records with control-plane typeids", async ({ fixture }) => {
    const email = `integration-auth-typeids-${randomUUID()}@example.com`;
    const organizationSlug = `integration-typeids-${randomUUID()}`;
    const inviteeEmail = `integration-auth-typeids-invitee-${randomUUID()}@example.com`;

    const sendOtpResponse = await fixture.request("/v1/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        type: "sign-in",
      }),
    });
    expect(sendOtpResponse.status).toBe(200);

    const verification = await fixture.db.query.verifications.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.identifier, `sign-in-otp-${email}`),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
    expect(verification).toBeDefined();
    if (verification === undefined) {
      throw new Error("Expected sign-in OTP verification row to exist.");
    }
    expectTypeIdPrefix(verification.id, "vrf");

    const otp = await readLatestSignInOtp({
      db: fixture.db,
      email,
      otpLength: fixture.config.auth.otpLength,
    });

    const signInResponse = await fixture.request("/v1/auth/sign-in/email-otp", {
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

    const user = await fixture.db.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.email, email),
    });
    expect(user).toBeDefined();
    if (user === undefined) {
      throw new Error("Expected user to be created after OTP sign-in.");
    }
    expectTypeIdPrefix(user.id, "usr");

    const session = await fixture.db.query.sessions.findFirst({
      columns: {
        id: true,
        activeOrganizationId: true,
      },
      where: (table, { eq }) => eq(table.userId, user.id),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
    expect(session).toBeDefined();
    if (session === undefined) {
      throw new Error("Expected session to be created after OTP sign-in.");
    }
    expectTypeIdPrefix(session.id, "ses");
    expect(session.activeOrganizationId).toBeNull();

    const createOrganizationResponse = await fixture.request("/v1/auth/organization/create", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "Integration TypeID Organization",
        slug: organizationSlug,
      }),
    });
    expect(createOrganizationResponse.status).toBe(200);

    const organization = await fixture.db.query.organizations.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.slug, organizationSlug),
    });
    expect(organization).toBeDefined();
    if (organization === undefined) {
      throw new Error("Expected organization to be created.");
    }
    expectTypeIdPrefix(organization.id, "org");

    const member = await fixture.db.query.members.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.organizationId, organization.id), eq(table.userId, user.id)),
    });
    expect(member).toBeDefined();
    if (member === undefined) {
      throw new Error("Expected organization membership to be created.");
    }
    expectTypeIdPrefix(member.id, "mbr");

    const team = await fixture.db.query.teams.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.organizationId, organization.id),
    });
    expect(team).toBeDefined();
    if (team === undefined) {
      throw new Error("Expected default team to be created.");
    }
    expectTypeIdPrefix(team.id, "tem");

    const teamMember = await fixture.db.query.teamMembers.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) => and(eq(table.teamId, team.id), eq(table.userId, user.id)),
    });
    expect(teamMember).toBeDefined();
    if (teamMember === undefined) {
      throw new Error("Expected default team membership to be created.");
    }
    expectTypeIdPrefix(teamMember.id, "tmb");

    const inviteResponse = await fixture.request("/v1/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        organizationId: organization.id,
        email: inviteeEmail,
        role: "member",
      }),
    });
    expect(inviteResponse.status).toBe(200);

    const invitation = await fixture.db.query.invitations.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, organization.id),
          eq(table.email, inviteeEmail),
          eq(table.status, "pending"),
        ),
    });
    expect(invitation).toBeDefined();
    if (invitation === undefined) {
      throw new Error("Expected invitation to be created.");
    }
    expectTypeIdPrefix(invitation.id, "inv");
  });
});
